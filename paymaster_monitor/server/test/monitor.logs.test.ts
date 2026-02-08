import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MonitorServer } from "../src/server";

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("paymaster_monitor/server logs", () => {
  let server: MonitorServer;
  let baseUrl: string;
  const dataDir = "/tmp/gasless-swap-monitor-test-logs";

  beforeAll(async () => {
    fs.rmSync(dataDir, { recursive: true, force: true });

    server = new MonitorServer({
      host: "127.0.0.1",
      port: 0,
      adminToken: "test_token",
      rpcUrl: "http://127.0.0.1:8545",
      deploymentsPath: undefined,
      dataDir,
      logRetentionMax: 1000,
      healthCheckIntervalSec: 1,
      indexerEnabled: false,
      indexerPollIntervalSec: 5,
      indexerLookbackBlocks: 5000,
      indexerMaxBlockRange: 2000,
      chainEventRetentionMax: 1000,
      bundlerPortRange: { start: 4100, end: 4199 },
      bundlerEngineCmd: `${process.execPath} ${require("node:path").join(__dirname, "fixtures", "dummyBundler.js")}`,
      bundlerPrivateKey: undefined,
    });

    const started = await server.start();
    baseUrl = started.url;
  }, 30_000);

  afterAll(async () => {
    await server.stop();
  });

  it("ingests and queries logs", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const ingestRes = await fetch(`${baseUrl}/api/logs/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ts,
        level: "info",
        service: "test",
        msg: "hello world",
        meta: { a: 1 },
      }),
    }).then((r) => r.json());

    expect(ingestRes.ok).toBe(true);

    const queryRes = await fetch(`${baseUrl}/api/logs?service=test&limit=10`).then((r) => r.json());
    expect(Array.isArray(queryRes.logs)).toBe(true);
    expect(queryRes.logs.length).toBeGreaterThan(0);
    expect(queryRes.logs.at(-1).msg).toBe("hello world");

    // persisted to NDJSON
    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    const logPath = path.join(dataDir, "logs", `${day}.ndjson`);
    const onDisk = fs.readFileSync(logPath, "utf8");
    expect(onDisk).toContain("hello world");
  });

  it("rehydrates logs from disk after restart", async () => {
    await server.stop();

    server = new MonitorServer({
      host: "127.0.0.1",
      port: 0,
      adminToken: "test_token",
      rpcUrl: "http://127.0.0.1:8545",
      deploymentsPath: undefined,
      dataDir,
      logRetentionMax: 1000,
      healthCheckIntervalSec: 1,
      indexerEnabled: false,
      indexerPollIntervalSec: 5,
      indexerLookbackBlocks: 5000,
      indexerMaxBlockRange: 2000,
      chainEventRetentionMax: 1000,
      bundlerPortRange: { start: 4100, end: 4199 },
      bundlerEngineCmd: `${process.execPath} ${require("node:path").join(__dirname, "fixtures", "dummyBundler.js")}`,
      bundlerPrivateKey: undefined,
    });

    const started = await server.start();
    baseUrl = started.url;

    const queryRes = await fetch(`${baseUrl}/api/logs?service=test&limit=10`).then((r) => r.json());
    expect(queryRes.logs.some((l: any) => l.msg === "hello world")).toBe(true);
  });

  it("streams logs over SSE", async () => {
    const controller = new AbortController();
    const streamPromise = fetch(`${baseUrl}/api/logs/stream`, { signal: controller.signal }).then(async (res) => {
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      const chunks: string[] = [];
      const start = Date.now();
      while (Date.now() - start < 2_000) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value).toString("utf8"));
        if (chunks.join("").includes("event: log")) break;
      }
      return chunks.join("");
    });

    await sleep(100);

    await fetch(`${baseUrl}/api/logs/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ts: Math.floor(Date.now() / 1000),
        level: "info",
        service: "sse",
        msg: "stream me",
      }),
    });

    const content = await streamPromise;
    controller.abort();
    expect(content).toContain("stream me");
  });
});
