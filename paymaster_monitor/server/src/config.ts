import os from "node:os";
import path from "node:path";

export type PortRange = { start: number; end: number };

export type MonitorServerConfig = {
  host: string;
  port: number;
  adminToken: string;

  rpcUrl: string;
  deploymentsPath?: string;

  dataDir: string;
  logRetentionMax: number;
  healthCheckIntervalSec: number;

  indexerEnabled: boolean;
  indexerPollIntervalSec: number;
  indexerLookbackBlocks: number;
  indexerMaxBlockRange: number;
  chainEventRetentionMax: number;

  bundlerPortRange: PortRange;
  bundlerEngineCmd?: string; // overrides the default bundler CLI spawn (used by tests)
  bundlerPrivateKey?: string; // forwarded to spawned bundlers
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return parsed;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  throw new Error(`Invalid ${name}: ${raw}`);
}

function parsePortRange(raw: string | undefined, fallback: PortRange): PortRange {
  if (!raw) return fallback;
  const parts = raw.split("-").map((p) => p.trim());
  if (parts.length !== 2) throw new Error(`Invalid BUNDLER_PORT_RANGE: ${raw}`);
  const start = Number(parts[0]);
  const end = Number(parts[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || start > end) {
    throw new Error(`Invalid BUNDLER_PORT_RANGE: ${raw}`);
  }
  return { start, end };
}

export function readMonitorConfigFromEnv(): MonitorServerConfig {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = parseIntEnv("PORT", 3002);
  const adminToken = process.env.ADMIN_TOKEN ?? "dev_admin_token";

  const rpcUrl = process.env.RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";
  const deploymentsPath = process.env.DEPLOYMENTS_PATH;

  const dataDir =
    process.env.DATA_DIR ?? path.join(os.tmpdir(), "gasless-swap-monitor");

  const logRetentionMax = parseIntEnv("LOG_RETENTION_MAX", 5000);
  const healthCheckIntervalSec = parseIntEnv("HEALTHCHECK_INTERVAL_SEC", 5);

  const indexerEnabled = parseBoolEnv("INDEXER_ENABLED", Boolean(deploymentsPath));
  const indexerPollIntervalSec = parseIntEnv("INDEXER_POLL_INTERVAL_SEC", 5);
  const indexerLookbackBlocks = parseIntEnv("INDEXER_LOOKBACK_BLOCKS", 5_000);
  const indexerMaxBlockRange = parseIntEnv("INDEXER_MAX_BLOCK_RANGE", 2_000);
  const chainEventRetentionMax = parseIntEnv("CHAIN_EVENT_RETENTION_MAX", 5_000);

  const bundlerPortRange = parsePortRange(process.env.BUNDLER_PORT_RANGE, { start: 3100, end: 3199 });
  const bundlerEngineCmd = process.env.BUNDLER_ENGINE_CMD;
  const bundlerPrivateKey = process.env.BUNDLER_PRIVATE_KEY;

  return {
    host,
    port,
    adminToken,
    rpcUrl,
    deploymentsPath,
    dataDir,
    logRetentionMax,
    healthCheckIntervalSec,
    indexerEnabled,
    indexerPollIntervalSec,
    indexerLookbackBlocks,
    indexerMaxBlockRange,
    chainEventRetentionMax,
    bundlerPortRange,
    bundlerEngineCmd,
    bundlerPrivateKey,
  };
}
