import Debug from "debug";

import { readMonitorConfigFromEnv } from "./config";
import { MonitorServer } from "./server";

const debug = Debug("gasless-swap:monitor:cli");

async function main(): Promise<void> {
  const config = readMonitorConfigFromEnv();
  const server = new MonitorServer(config);
  const started = await server.start();

  debug("started: %o", started);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

