import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MonitorServer } from "../src/server";

describe("paymaster_monitor/server bundler spawn lifecycle", () => {
  let server: MonitorServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = new MonitorServer({
      host: "127.0.0.1",
      port: 0,
      adminToken: "test_token",
      rpcUrl: "http://127.0.0.1:8545",
      deploymentsPath: undefined,
      dataDir: "/tmp/gasless-swap-monitor-test-spawn",
      logRetentionMax: 5000,
      healthCheckIntervalSec: 1,
      indexerEnabled: false,
      indexerPollIntervalSec: 5,
      indexerLookbackBlocks: 5000,
      indexerMaxBlockRange: 2000,
      chainEventRetentionMax: 1000,
      bundlerPortRange: { start: 4200, end: 4299 },
      bundlerEngineCmd: `${process.execPath} ${require("node:path").join(__dirname, "fixtures", "dummyBundler.js")}`,
      bundlerPrivateKey: undefined,
    });
    const started = await server.start();
    baseUrl = started.url;
  }, 30_000);

  afterAll(async () => {
    await server.stop();
  });

  it("spawns and stops a bundler process", async () => {
    const spawnRes = await fetch(`${baseUrl}/api/admin/bundlers/spawn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test_token",
      },
      body: JSON.stringify({
        base: "bundler2",
        name: "Dummy bundler",
        policy: { strict: false, minPriorityFeeGwei: 0.1 },
      }),
    }).then((r) => r.json());

    expect(spawnRes.id).toMatch(/^bundler2_/);
    expect(spawnRes.rpcUrl).toContain("/rpc");

    // wait for health checks to mark it UP
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const list = await fetch(`${baseUrl}/api/admin/bundlers`, {
        headers: { authorization: "Bearer test_token" },
      }).then((r) => r.json());
      const inst = list.find((b: any) => b.id === spawnRes.id);
      if (inst?.status === "UP") break;
      if (Date.now() - start > 5_000) throw new Error("timed out waiting for bundler UP");
      await new Promise((r) => setTimeout(r, 200));
    }

    const stopRes = await fetch(`${baseUrl}/api/admin/bundlers/${spawnRes.id}/stop`, {
      method: "POST",
      headers: { authorization: "Bearer test_token" },
    }).then((r) => r.json());
    expect(stopRes.ok).toBe(true);
  });
});
