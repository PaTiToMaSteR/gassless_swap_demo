import { BundlerEngine } from "./BundlerEngine";
import { BundlerServer } from "./BundlerServer";
import type { BundlerConfig } from "./types";

export async function startBundler(config: BundlerConfig): Promise<BundlerServer> {
  const engine = new BundlerEngine(config);
  const server = new BundlerServer(engine, config);
  await server.start();
  return server;
}

export { BundlerEngine, BundlerServer };

