import fs from "node:fs";

import type { BundlerConfig } from "./types";

export function readBundlerConfig(configPath: string): BundlerConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as BundlerConfig;

  if (!parsed.network) throw new Error("config.network is required");
  if (!parsed.entryPoint) throw new Error("config.entryPoint is required");
  if (!parsed.port) throw new Error("config.port is required");
  if (!parsed.beneficiary) throw new Error("config.beneficiary is required");
  if (parsed.autoBundleInterval == null)
    throw new Error("config.autoBundleInterval is required");
  if (parsed.autoBundleMempoolSize == null)
    throw new Error("config.autoBundleMempoolSize is required");
  if (parsed.maxBundleGas == null)
    throw new Error("config.maxBundleGas is required");

  return parsed;
}

