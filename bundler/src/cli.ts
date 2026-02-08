import { Command } from "commander";

import { readBundlerConfig } from "./config";
import { startBundler } from "./index";

async function main(): Promise<void> {
  const program = new Command();

  program.option("--config <path>", "Path to bundler.config.json", "bundler.config.json");
  program.parse(process.argv);

  const { config: configPath } = program.opts<{ config: string }>();
  const config = readBundlerConfig(configPath);

  // eslint-disable-next-line no-console
  console.log("Starting bundler with config:", configPath);

  await startBundler(config);

  // eslint-disable-next-line no-console
  console.log(`Bundler listening on http://127.0.0.1:${config.port}/rpc`);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

