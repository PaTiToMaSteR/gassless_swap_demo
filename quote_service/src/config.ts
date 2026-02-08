import os from "node:os";
import path from "node:path";

export type QuoteServiceConfig = {
  host: string;
  port: number;
  rpcUrl: string;
  deploymentsPath: string;
  quoteTtlSec: number;
  logIngestUrl?: string; // optional: paymaster_monitor/server log ingest endpoint
  dataDir: string;
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return parsed;
}

export function readQuoteServiceConfigFromEnv(): QuoteServiceConfig {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = parseIntEnv("PORT", 3001);
  const rpcUrl = process.env.RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";

  const deploymentsPath = process.env.DEPLOYMENTS_PATH;
  if (!deploymentsPath) throw new Error("DEPLOYMENTS_PATH is required");

  const quoteTtlSec = parseIntEnv("QUOTE_TTL_SEC", 60);
  const logIngestUrl = process.env.LOG_INGEST_URL;

  const dataDir = process.env.DATA_DIR ?? path.join(os.tmpdir(), "gasless-swap-quotes");

  return { host, port, rpcUrl, deploymentsPath, quoteTtlSec, logIngestUrl, dataDir };
}

