import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import bodyParser from "body-parser";
import cors from "cors";
import Debug from "debug";
import express from "express";

import type { MonitorServerConfig } from "./config";
import type { BundlerInstancePublic, LogEvent, UsersResponse, WalletStats } from "./types";
import { BundlerRegistry } from "./stores/BundlerRegistry";
import { LogStore } from "./stores/LogStore";
import { getLandingPage } from "./landingPage";
import { NdjsonLogWriter } from "./stores/NdjsonLogWriter";
import { UserOpAnalyticsStore } from "./stores/UserOpAnalyticsStore";
import { WalletAnalyticsStore } from "./stores/WalletAnalyticsStore";
import { TelemetryStore } from "./stores/TelemetryStore";
import { readDeployments } from "./chain/deployments";
import { OnChainIndexer } from "./chain/indexer";
import { getPaymasterStatus } from "./chain/paymasterStatus";
import { randomId, nowTsSec } from "./util/ids";
import { jsonRpcCall } from "./util/jsonRpc";

const debug = Debug("gasless-swap:monitor");

type SpawnRequest = {
  base: "bundler1" | "bundler2";
  name?: string;
  policy?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitLines(chunk: Buffer): string[] {
  return chunk
    .toString("utf8")
    .split(/\r?\n/)
    .map((s) => s.trimEnd())
    .filter(Boolean);
}

async function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

export class MonitorServer {
  private readonly app = express();
  private httpServer?: import("http").Server;

  private readonly logs: LogStore;
  private readonly logWriter: NdjsonLogWriter;
  private readonly userOps: UserOpAnalyticsStore;
  private readonly wallets: WalletAnalyticsStore;
  private indexer?: OnChainIndexer;
  private readonly bundlers = new BundlerRegistry();
  private readonly telemetry = new TelemetryStore();
  private healthTimer?: NodeJS.Timeout;

  private startedAtTs = nowTsSec();

  constructor(readonly config: MonitorServerConfig) {
    this.logs = new LogStore({ max: config.logRetentionMax });
    this.logWriter = new NdjsonLogWriter({ dataDir: config.dataDir });
    this.userOps = new UserOpAnalyticsStore({ max: config.chainEventRetentionMax });
    this.wallets = new WalletAnalyticsStore({ max: config.chainEventRetentionMax });

    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: "2mb" }));

    this._mountRoutes();
  }

  async start(): Promise<{ url: string; port: number }> {
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    // Restore recent logs so the UI has context after restarts.
    const restored = this.logWriter.loadRecent(this.config.logRetentionMax);
    this.logs.ingest(restored, { notify: false });

    await new Promise<void>((resolve) => {
      this.httpServer = this.app.listen(this.config.port, this.config.host, () => resolve());
    });

    const addr = this.httpServer!.address();
    const port = typeof addr === "object" && addr ? addr.port : this.config.port;
    const url = `http://${this.config.host}:${port}`;

    debug("monitor server started at %s", url);

    this._startHealthChecks();

    if (this.config.indexerEnabled && this.config.deploymentsPath) {
      try {
        this.indexer = await OnChainIndexer.fromDeployments({
          rpcUrl: this.config.rpcUrl,
          deploymentsPath: this.config.deploymentsPath,
          dataDir: this.config.dataDir,
          pollIntervalSec: this.config.indexerPollIntervalSec,
          lookbackBlocks: this.config.indexerLookbackBlocks,
          maxBlockRange: this.config.indexerMaxBlockRange,
          retentionMax: this.config.chainEventRetentionMax,
          store: this.userOps,
          walletStore: this.wallets,
          logger: (level, msg, meta) => {
            void this._recordLogs(
              [
                {
                  ts: nowTsSec(),
                  level,
                  service: "indexer",
                  msg,
                  meta,
                },
              ],
              { awaitPersist: false },
            );
          },
        });
        await this.indexer.start();
      } catch (err: any) {
        void this._recordLogs(
          [
            {
              ts: nowTsSec(),
              level: "warn",
              service: "indexer",
              msg: "indexer failed to start",
              meta: { error: err?.message ?? String(err) },
            },
          ],
          { awaitPersist: false },
        );
      }
    }

    return { url, port };
  }

  async stop(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);

    for (const inst of this.bundlers.list()) {
      if (inst.spawned && inst.process && inst.status !== "STOPPED") {
        inst.process.kill("SIGTERM");
      }
    }

    await this.indexer?.stop();
    await this.logWriter.flush();

    if (!this.httpServer) return;
    await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
  }

  // --- routes ---

  private _mountRoutes(): void {
    this.app.get("/", (_req, res) => {
      res.send(
        getLandingPage({
          title: "Paymaster Monitor",
          status: "UP",
          version: "v0.7",
          links: [
            { label: "Admin Dashboard", url: "http://127.0.0.1:5174" },
            { label: "Health Check", url: "/api/public/health" },
            { label: "Bundlers", url: "/api/public/bundlers" },
          ],
        }),
      );
    });

    this.app.get("/api/public/health", async (_req, res) => {
      const bundlers = this.bundlers.listPublic();
      res.json({
        ok: true,
        startedAt: this.startedAtTs,
        bundlersUp: bundlers.filter((b) => b.status === "UP").length,
        bundlersTotal: bundlers.length,
        logsCount: this.logs.count(),
      });
    });

    this.app.get("/api/public/bundlers", async (_req, res) => {
      const list = this.bundlers.listPublic();
      res.json(list);
    });

    this.app.get("/api/public/deployments", async (_req, res) => {
      if (!this.config.deploymentsPath) return res.status(404).json({ error: "DEPLOYMENTS_PATH not configured" });
      const deployments = readDeployments(this.config.deploymentsPath);
      res.json(deployments);
    });

    this.app.get("/api/public/wallets/active", async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      res.json(this.wallets.listActive(limit));
    });

    this.app.get("/api/public/wallets/rich", async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      res.json(this.wallets.listRich(limit));
    });

    // --- auth middleware for admin ---
    this.app.use("/api/admin", (req, res, next) => {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (!token || token !== this.config.adminToken) {
        return res.status(401).json({ error: "unauthorized" });
      }
      next();
    });

    this.app.get("/api/admin/bundlers", async (_req, res) => {
      res.json(this.bundlers.listPublic());
    });

    this.app.post("/api/admin/bundlers/register", async (req, res) => {
      const body = req.body as any;
      if (!isRecord(body) || typeof body.rpcUrl !== "string" || typeof body.name !== "string") {
        return res.status(400).json({ error: "Invalid body (name, rpcUrl required)" });
      }

      const id = randomId("bundler");
      const instance: BundlerInstancePublic = {
        id,
        name: body.name,
        rpcUrl: body.rpcUrl,
        status: "DOWN",
        policy: isRecord(body.policy) ? (body.policy as any) : {},
        spawned: false,
      };
      this.bundlers.upsert({ ...instance, spawnedAt: nowTsSec() });
      res.json(instance);
    });

    this.app.post("/api/admin/bundlers/spawn", async (req, res) => {
      const body = req.body as SpawnRequest;
      if (!body || (body.base !== "bundler1" && body.base !== "bundler2")) {
        return res.status(400).json({ error: "Invalid body (base must be bundler1|bundler2)" });
      }

      try {
        const spawned = await this._spawnBundler(body);
        res.json(spawned);
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "spawn failed" });
      }
    });

    this.app.post("/api/admin/bundlers/:id/stop", async (req, res) => {
      const id = req.params.id;
      const inst = this.bundlers.get(id);
      if (!inst) return res.status(404).json({ error: "not found" });
      if (!inst.spawned || !inst.process) return res.status(400).json({ error: "not a spawned bundler" });

      inst.process.kill("SIGTERM");
      inst.status = "STOPPED";
      res.json({ ok: true });
    });

    this.app.post("/api/admin/bundlers/:id/unregister", async (req, res) => {
      const id = req.params.id;
      const inst = this.bundlers.get(id);
      if (!inst) return res.status(404).json({ error: "not found" });
      if (inst.spawned && inst.process && inst.status !== "STOPPED") inst.process.kill("SIGTERM");
      this.bundlers.remove(id);
      res.json({ ok: true });
    });

    this.app.get("/api/admin/paymaster/status", async (_req, res) => {
      if (!this.config.deploymentsPath) return res.status(400).json({ error: "DEPLOYMENTS_PATH not configured" });
      const deployments = readDeployments(this.config.deploymentsPath);

      const abisDir = path.join(path.dirname(this.config.deploymentsPath), "abis");
      try {
        const status = await getPaymasterStatus({ rpcUrl: this.config.rpcUrl, abisDir, deployments });
        res.json(status);
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "paymaster status failed" });
      }
    });

    this.app.get("/api/admin/metrics/summary", async (_req, res) => {
      const sessions = this.telemetry.getActiveCounts({ windowMs: 30_000 });
      const userOps = this.userOps.metricsSummary();
      res.json({
        startedAt: this.startedAtTs,
        sessions,
        uniqueOwners: this.telemetry.getUniqueOwnersCount(),
        bundlersUp: this.bundlers.listPublic().filter((b) => b.status === "UP").length,
        bundlersTotal: this.bundlers.listPublic().length,
        logsCount: this.logs.count(),
        userOps,
        paidFallback: this.telemetry.getPaidFallbackMetrics(),
      });
    });

    this.app.get("/api/admin/metrics/failures", async (_req, res) => {
      res.json({ failures: this.userOps.getFailureMetrics() });
    });

    this.app.get("/api/admin/metrics/timeseries", async (req, res) => {
      const q = (k: string): string | undefined => (typeof req.query[k] === "string" ? String(req.query[k]) : undefined);
      const windowSec = q("windowSec") ? Number(q("windowSec")) : undefined;
      const bucketSec = q("bucketSec") ? Number(q("bucketSec")) : undefined;
      res.json({ series: this.userOps.timeseries({ windowSec, bucketSec }) });
    });

    this.app.get("/api/admin/userops", async (req, res) => {
      const q = (k: string): string | undefined => (typeof req.query[k] === "string" ? String(req.query[k]) : undefined);
      const limit = q("limit") ? Number(q("limit")) : undefined;
      const sender = q("sender");
      const success = q("success") as any;
      res.json({ userops: this.userOps.listUserOps({ limit, sender, success }) });
    });

    this.app.get("/api/admin/users", async (_req, res) => {
      const senderMetrics = this.userOps.perSenderMetrics();
      const telemetryOwners = this.telemetry.listOwners();
      const telemetrySenders = this.telemetry.listSenders();

      const senderMetricsByKey = new Map(senderMetrics.map((m) => [m.sender.toLowerCase(), m]));
      const senderTelemetryByKey = new Map(telemetrySenders.map((t) => [t.sender.toLowerCase(), t]));

      const senderKeys = new Set<string>([...senderMetricsByKey.keys(), ...senderTelemetryByKey.keys()]);
      const senders: UsersResponse["senders"] = Array.from(senderKeys)
        .map((key) => {
          const m = senderMetricsByKey.get(key);
          const t = senderTelemetryByKey.get(key);
          return {
            sender: ((m?.sender ?? t?.sender ?? key) as any),
            total: m?.total ?? 0,
            succeeded: m?.succeeded ?? 0,
            failed: m?.failed ?? 0,
            lastOpTs: m?.lastOpTs,
            totalActualGasCostWei: m?.totalActualGasCostWei ?? "0",
            totalFeeAmount: m?.totalFeeAmount ?? "0",
            firstSeenMs: t?.firstSeenMs,
            lastSeenMs: t?.lastSeenMs,
            owner: (t?.owner as any) ?? undefined,
          };
        })
        .sort((a, b) => (b.lastOpTs ?? 0) - (a.lastOpTs ?? 0) || (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0));

      const owners: UsersResponse["owners"] = telemetryOwners
        .map((o) => {
          let total = 0;
          let succeeded = 0;
          let failed = 0;
          let lastOpTs = 0;
          let gasWei = BigInt(0);
          let feeWei = BigInt(0);

          for (const s of o.senders) {
            const m = senderMetricsByKey.get(s.toLowerCase());
            if (!m) continue;
            total += m.total;
            succeeded += m.succeeded;
            failed += m.failed;
            lastOpTs = Math.max(lastOpTs, m.lastOpTs ?? 0);
            try {
              gasWei += BigInt(m.totalActualGasCostWei);
            } catch {
              // ignore
            }
            try {
              feeWei += BigInt(m.totalFeeAmount);
            } catch {
              // ignore
            }
          }

          return {
            owner: o.owner as any,
            firstSeenMs: o.firstSeenMs,
            lastSeenMs: o.lastSeenMs,
            senders: o.senders as any,
            total,
            succeeded,
            failed,
            lastOpTs: lastOpTs || undefined,
            totalActualGasCostWei: gasWei.toString(),
            totalFeeAmount: feeWei.toString(),
          };
        })
        .sort((a, b) => b.lastSeenMs - a.lastSeenMs);

      const body: UsersResponse = { owners, senders, wallets: this.wallets.listRich(10) };
      res.json(body);
    });

    // --- logs ---
    this.app.post("/api/logs/ingest", async (req, res) => {
      const body = req.body;
      const events: LogEvent[] = [];

      const coerce = (raw: any): LogEvent | null => {
        if (!isRecord(raw)) return null;
        if (typeof raw.ts !== "number" || typeof raw.level !== "string" || typeof raw.service !== "string" || typeof raw.msg !== "string") return null;
        const ts = raw.ts;
        const level = raw.level as LogEvent["level"];
        if (!["debug", "info", "warn", "error"].includes(level)) return null;

        return {
          ts,
          level,
          service: raw.service,
          msg: raw.msg,
          requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
          sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
          quoteId: typeof raw.quoteId === "string" ? raw.quoteId : undefined,
          userOpHash: typeof raw.userOpHash === "string" ? (raw.userOpHash as any) : undefined,
          sender: typeof raw.sender === "string" ? (raw.sender as any) : undefined,
          owner: typeof raw.owner === "string" ? (raw.owner as any) : undefined,
          txHash: typeof raw.txHash === "string" ? (raw.txHash as any) : undefined,
          chainId: typeof raw.chainId === "number" ? raw.chainId : undefined,
          meta: isRecord(raw.meta) ? raw.meta : undefined,
        };
      };

      if (Array.isArray(body)) {
        for (const raw of body) {
          const e = coerce(raw);
          if (e) events.push(e);
        }
      } else {
        const e = coerce(body);
        if (e) events.push(e);
      }

      if (events.length === 0) return res.status(400).json({ error: "No valid LogEvent found" });

      await this._recordLogs(events, { awaitPersist: true });
      res.json({ ok: true, ingested: events.length });
    });

    this.app.get("/api/logs", async (req, res) => {
      const q = (k: string): string | undefined => (typeof req.query[k] === "string" ? String(req.query[k]) : undefined);
      const since = q("since") ? Number(q("since")) : undefined;
      const until = q("until") ? Number(q("until")) : undefined;
      const limit = q("limit") ? Number(q("limit")) : undefined;
      const logs = this.logs.query({
        service: q("service"),
        level: q("level"),
        q: q("q"),
        requestId: q("requestId"),
        quoteId: q("quoteId"),
        userOpHash: q("userOpHash"),
        sender: q("sender"),
        txHash: q("txHash"),
        since: Number.isFinite(since as any) ? since : undefined,
        until: Number.isFinite(until as any) ? until : undefined,
        limit: Number.isFinite(limit as any) ? limit : undefined,
      });
      res.json({ logs });
    });

    this.app.get("/api/logs/stream", async (req, res) => {
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");
      res.flushHeaders();

      const unsub = this.logs.subscribe((log) => {
        res.write(`event: log\n`);
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      });

      req.on("close", () => {
        unsub();
      });
    });

    // --- telemetry ---
    this.app.post("/api/telemetry/session", async (req, res) => {
      const body = req.body as any;
      if (!isRecord(body) || typeof body.sessionId !== "string" || typeof body.app !== "string") {
        return res.status(400).json({ error: "Invalid body (sessionId, app)" });
      }
      if (body.app !== "web" && body.app !== "admin") return res.status(400).json({ error: "Invalid app" });

      this.telemetry.upsertSession({
        sessionId: body.sessionId,
        app: body.app,
        owner: typeof body.owner === "string" ? body.owner : undefined,
        sender: typeof body.sender === "string" ? body.sender : undefined,
      });

      res.json({ ok: true });
    });

    this.app.post("/api/telemetry/event", async (req, res) => {
      const body = req.body as any;
      const name = body?.name;
      if (
        !isRecord(body) ||
        (name !== "paid_fallback_attempt" && name !== "paid_fallback_success" && name !== "paid_fallback_failure")
      ) {
        return res.status(400).json({ error: "Invalid body (name)" });
      }

      this.telemetry.recordEvent(name);
      res.json({ ok: true });
    });
  }

  // --- bundler spawn + health ---

  private async _spawnBundler(req: SpawnRequest): Promise<BundlerInstancePublic> {
    const id = randomId(req.base);
    const name = req.name ?? `${req.base} (${id})`;

    const port = await this._allocateBundlerPort();
    const rpcUrl = `http://${this.config.host}:${port}/rpc`;

    const repoRoot = path.resolve(__dirname, "../../..");
    const baseConfigPath = path.join(repoRoot, req.base, "bundler.config.example.json");
    const baseConfigRaw = JSON.parse(fs.readFileSync(baseConfigPath, "utf8")) as any;

    const deployments = this.config.deploymentsPath ? readDeployments(this.config.deploymentsPath) : undefined;

    const merged = {
      ...baseConfigRaw,
      network: this.config.rpcUrl,
      entryPoint: deployments?.entryPoint ?? baseConfigRaw.entryPoint,
      port: String(port),
      beneficiary: baseConfigRaw.beneficiary ?? "0x0000000000000000000000000000000000000000",
      policy: { ...(baseConfigRaw.policy ?? {}), ...(isRecord(req.policy) ? req.policy : {}) },
      observability: {
        ...(baseConfigRaw.observability ?? {}),
        service: id,
      },
    };

    const dir = path.join(this.config.dataDir, "bundlers", id);
    fs.mkdirSync(dir, { recursive: true });
    const configPath = path.join(dir, "bundler.config.json");
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));

    const cmd = this._getBundlerEngineCommand(repoRoot);
    const childEnv = {
      ...process.env,
      BUNDLER_PRIVATE_KEY: this.config.bundlerPrivateKey ?? process.env.BUNDLER_PRIVATE_KEY ?? "",
      DEBUG: process.env.DEBUG ?? "",
    };

    debug("spawning %s: %s", id, cmd.join(" "));

    const child = spawn(cmd[0], [...cmd.slice(1), "--config", configPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });

    const ingestLine = (level: LogEvent["level"], line: string) => {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return;

      try {
        const parsed = JSON.parse(trimmed) as any;
        if (
          isRecord(parsed) &&
          typeof parsed.ts === "number" &&
          typeof parsed.level === "string" &&
          typeof parsed.service === "string" &&
          typeof parsed.msg === "string"
        ) {
          return;
        }
      } catch {
        // ignore
      }

      void this._recordLogs(
        [
          {
            ts: nowTsSec(),
            level,
            service: id,
            msg: trimmed,
            meta: { source: level === "error" ? "stderr" : "stdout", pid: child.pid, base: req.base },
          },
        ],
        { awaitPersist: false },
      );
    };

    child.stdout?.on("data", (chunk: Buffer) => splitLines(chunk).forEach((l) => ingestLine("info", l)));
    child.stderr?.on("data", (chunk: Buffer) => splitLines(chunk).forEach((l) => ingestLine("error", l)));

    child.on("exit", (code, signal) => {
      ingestLine("warn", `process exited (code=${code}, signal=${signal})`);
      this.bundlers.updateStatus(id, "STOPPED");
    });

    const instance: BundlerInstancePublic = {
      id,
      name,
      rpcUrl,
      status: "DOWN",
      policy: merged.policy ?? {},
      spawned: true,
    };

    this.bundlers.upsert({
      ...instance,
      port,
      spawnedAt: nowTsSec(),
      pid: child.pid,
      process: child,
      configPath,
      base: req.base,
    });

    return instance;
  }

  private async _recordLogs(events: LogEvent[], opts?: { awaitPersist?: boolean }): Promise<void> {
    this.logs.ingest(events);
    const write = this.logWriter.append(events);
    if (opts?.awaitPersist) await write;
  }

  private _getBundlerEngineCommand(repoRoot: string): string[] {
    if (this.config.bundlerEngineCmd) return this.config.bundlerEngineCmd.split(" ").filter(Boolean);

    const bundlerCli = path.join(repoRoot, "bundler", "dist", "cli.js");
    return [process.execPath, bundlerCli];
  }

  private async _allocateBundlerPort(): Promise<number> {
    for (let p = this.config.bundlerPortRange.start; p <= this.config.bundlerPortRange.end; p++) {
      if (!this.bundlers.list().some((b) => b.port === p)) {
        if (await isPortAvailable(p, this.config.host)) return p;
      }
    }
    throw new Error("No available bundler port in range");
  }

  private _startHealthChecks(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    const intervalMs = Math.max(1, this.config.healthCheckIntervalSec) * 1000;
    this.healthTimer = setInterval(() => void this._runHealthChecks(), intervalMs);
    void this._runHealthChecks();
  }

  private async _runHealthChecks(): Promise<void> {
    const instances = this.bundlers.list();
    for (const inst of instances) {
      if (inst.status === "STOPPED") continue;
      try {
        await jsonRpcCall<string>(inst.rpcUrl, "web3_clientVersion");
        this.bundlers.updateStatus(inst.id, "UP", nowTsSec());
      } catch {
        this.bundlers.updateStatus(inst.id, "DOWN");
      }
    }
  }
}
