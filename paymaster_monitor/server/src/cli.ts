import Debug from "debug";

import { readMonitorConfigFromEnv } from "./config";
import { MonitorServer } from "./server";

const debug = Debug("gasless-swap:monitor:cli");

async function main(): Promise<void> {
  console.error("Monitor CLI: Starting...");
  try {
    const config = readMonitorConfigFromEnv();
    console.error("Monitor CLI: Config loaded", config);
    const server = new MonitorServer(config);
    console.error("Monitor CLI: Server created");
    const started = await server.start();
    console.error("Monitor CLI: Server started", started);

    debug("started: %o", started);

    const shutdown = async () => {
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } finally {
    // empty
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

