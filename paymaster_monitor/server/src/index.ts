import type { MonitorServerConfig } from "./config";
import { MonitorServer } from "./server";

export async function startMonitorServer(config: MonitorServerConfig): Promise<MonitorServer> {
  const server = new MonitorServer(config);
  await server.start();
  return server;
}

export { MonitorServer };

