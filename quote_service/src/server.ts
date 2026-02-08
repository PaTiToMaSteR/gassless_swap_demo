import fs from "node:fs";
import path from "node:path";

import bodyParser from "body-parser";
import cors from "cors";
import { ethers } from "ethers";
import express from "express";

import type { QuoteServiceConfig } from "./config";
import type { QuoteRequest, QuoteResponse } from "./types";
import { readDeployments } from "./chain/deployments";
import { Logger } from "./logging";
import { getLandingPage } from "./landingPage";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`Missing ${key}`);
  return v;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function readAbi(abisDir: string, name: string): any {
  const p = path.join(abisDir, `${name}.abi.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

type StoredQuote = { quote: QuoteResponse };

export class QuoteServiceServer {
  private readonly app = express();
  private httpServer?: import("http").Server;

  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly deployments: ReturnType<typeof readDeployments>;
  private readonly abisDir: string;
  private readonly routerInterface: ethers.utils.Interface;
  private readonly router: ethers.Contract;
  private readonly oracle: ethers.Contract;
  private readonly logger: Logger;

  private quotes = new Map<string, StoredQuote>();

  constructor(readonly config: QuoteServiceConfig) {
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    this.deployments = readDeployments(config.deploymentsPath);
    this.abisDir = path.join(path.dirname(config.deploymentsPath), "abis");
    this.routerInterface = new ethers.utils.Interface(readAbi(this.abisDir, "DemoRouter"));
    this.router = new ethers.Contract(this.deployments.router, this.routerInterface, this.provider);
    this.oracle = new ethers.Contract(this.deployments.oracle, readAbi(this.abisDir, "MockPriceOracle"), this.provider);
    this.logger = new Logger({ logIngestUrl: config.logIngestUrl });

    fs.mkdirSync(this.config.dataDir, { recursive: true });

    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: "2mb" }));

    this._mountRoutes();
  }

  async start(): Promise<{ url: string; port: number }> {
    await new Promise<void>((resolve) => {
      this.httpServer = this.app.listen(this.config.port, this.config.host, () => resolve());
    });

    const addr = this.httpServer!.address();
    const port = typeof addr === "object" && addr ? addr.port : this.config.port;
    const url = `http://${this.config.host}:${port}`;
    return { url, port };
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return;
    await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
  }

  private _mountRoutes(): void {
    this.app.get("/", (_req, res) => {
      res.send(
        getLandingPage({
          title: "Quote Service API",
          status: "UP",
          version: "v0.7",
          links: [
            { label: "Configuration", url: "/config" },
            { label: "Health Check", url: "/health" },
          ],
        }),
      );
    });

    this.app.get("/health", async (_req, res) => {
      try {
        const net = await this.provider.getNetwork();
        // simple sanity call
        await this.router.callStatic.quoteExactIn(this.deployments.tokenIn, this.deployments.tokenOut, 1);
        res.json({ ok: true, chainId: net.chainId });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message ?? "health failed" });
      }
    });

    this.app.get("/config", async (_req, res) => {
      const net = await this.provider.getNetwork();
      res.json({
        ok: true,
        chainId: net.chainId,
        quoteTtlSec: this.config.quoteTtlSec,
        deployments: this.deployments,
        supportedPairs: [
          { symbol: "USDC", tokenIn: this.deployments.usdc, tokenOut: this.deployments.tokenOut, router: this.deployments.router },
          { symbol: "BNB", tokenIn: this.deployments.bnb, tokenOut: this.deployments.tokenOut, router: this.deployments.router },
        ],
      });
    });

    this.app.post("/quote", async (req, res) => {
      try {
        if (!isRecord(req.body)) return res.status(400).json({ error: "Invalid JSON body" });
        const raw = req.body as Record<string, unknown>;

        const tokenIn = requireString(raw, "tokenIn");
        const tokenOut = requireString(raw, "tokenOut");
        const amountInRaw = requireString(raw, "amountIn");
        const sender = requireString(raw, "sender");

        if (!ethers.utils.isAddress(tokenIn) || !ethers.utils.isAddress(tokenOut) || !ethers.utils.isAddress(sender)) {
          return res.status(400).json({ error: "Invalid address" });
        }

        const amountIn = ethers.BigNumber.from(amountInRaw);
        const slippageBps = typeof raw.slippageBps === "number" ? raw.slippageBps : 50;
        if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
          return res.status(400).json({ error: "Invalid slippageBps" });
        }

        // Check if token pair is supported (tUSDC or fBNB against WAVAX)
        const isSupported =
          tokenOut.toLowerCase() === this.deployments.tokenOut.toLowerCase() &&
          (tokenIn.toLowerCase() === this.deployments.usdc.toLowerCase() ||
            tokenIn.toLowerCase() === this.deployments.bnb.toLowerCase());

        if (!isSupported) {
          return res.status(400).json({ error: "Unsupported token pair" });
        }

        const net = await this.provider.getNetwork();
        const createdAt = nowSec();
        const deadline = createdAt + this.config.quoteTtlSec;

        // Fetch "Fair Price" from Oracle
        const oraclePriceWei: ethers.BigNumber = await this.oracle.getPrice(tokenIn);
        const decimals = await this.oracle.decimals(tokenIn);

        // expectedOut (Wei) = (amountIn * oraclePriceWei) / 10^decimals
        const expectedOut = amountIn.mul(oraclePriceWei).div(ethers.BigNumber.from(10).pow(decimals));

        // Account for a small "simulated" pool spread (e.g. 0.3%)
        const minOut = expectedOut.mul(10_000 - (slippageBps + 30)).div(10_000);

        const calldata = this.routerInterface.encodeFunctionData("swapExactIn", [
          tokenIn,
          tokenOut,
          amountIn,
          minOut,
          sender,
          deadline,
        ]);

        const quote: QuoteResponse = {
          quoteId: randomId("quote"),
          chainId: net.chainId,
          createdAt,
          expiresAt: deadline,
          deadline,
          tokenIn: tokenIn as any,
          tokenOut: tokenOut as any,
          sender: sender as any,
          amountIn: amountIn.toString(),
          amountOut: expectedOut.toString(),
          minOut: minOut.toString(),
          route: {
            router: this.deployments.router as any,
            calldata: calldata as any,
          },
        };

        this.quotes.set(quote.quoteId, { quote });

        const requestId = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined;
        await this.logger.quoteCreated({ requestId, quote });

        res.json(quote);
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "quote failed" });
      }
    });

    this.app.get("/quote/:quoteId", async (req, res) => {
      const id = String(req.params.quoteId);
      const stored = this.quotes.get(id);
      if (!stored) return res.status(404).json({ error: "not found" });
      if (stored.quote.expiresAt < nowSec()) return res.status(410).json({ error: "quote expired" });
      return res.json(stored.quote);
    });

    this.app.get("/api/logs", async (_req, res) => {
      res.json(Logger.recentLogs.reverse());
    });
  }
}
