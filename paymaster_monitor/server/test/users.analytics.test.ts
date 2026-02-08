import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MonitorServer } from "../src/server";

describe("paymaster_monitor/server users analytics", () => {
  let server: MonitorServer;
  let baseUrl: string;

  const owner1 = "0x1111111111111111111111111111111111111111";
  const owner2 = "0x2222222222222222222222222222222222222222";
  const sender1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sender2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  beforeAll(async () => {
    server = new MonitorServer({
      host: "127.0.0.1",
      port: 0,
      adminToken: "test_token",
      rpcUrl: "http://127.0.0.1:8545",
      deploymentsPath: undefined,
      dataDir: "/tmp/gasless-swap-monitor-test-users",
      logRetentionMax: 5000,
      healthCheckIntervalSec: 1,
      indexerEnabled: false,
      indexerPollIntervalSec: 5,
      indexerLookbackBlocks: 5000,
      indexerMaxBlockRange: 2000,
      chainEventRetentionMax: 5000,
      bundlerPortRange: { start: 5200, end: 5299 },
      bundlerEngineCmd: undefined,
      bundlerPrivateKey: undefined,
    });
    const started = await server.start();
    baseUrl = started.url;

    // Telemetry mapping owner -> sender (from web sessions)
    await fetch(`${baseUrl}/api/telemetry/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "sess1", app: "web", owner: owner1, sender: sender1 }),
    });
    await fetch(`${baseUrl}/api/telemetry/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "sess2", app: "web", owner: owner2, sender: sender2 }),
    });

    // Seed indexed on-chain UserOps into the in-memory store (test-only).
    (server as any).userOps.ingestEntryPointEvents([
      {
        ts: 1000,
        chainId: 43113,
        blockNumber: 1,
        txHash: "0x" + "01".padStart(64, "0"),
        logIndex: 0,
        userOpHash: "0x" + "11".repeat(32),
        sender: sender1,
        paymaster: "0x" + "cc".repeat(20),
        nonce: "0",
        success: true,
        actualGasCostWei: "100",
        actualGasUsed: "10",
        bundler: "0x" + "dd".repeat(20),
      },
      {
        ts: 1010,
        chainId: 43113,
        blockNumber: 2,
        txHash: "0x" + "02".padStart(64, "0"),
        logIndex: 0,
        userOpHash: "0x" + "22".repeat(32),
        sender: sender1,
        paymaster: "0x" + "cc".repeat(20),
        nonce: "1",
        success: false,
        actualGasCostWei: "200",
        actualGasUsed: "20",
        bundler: "0x" + "dd".repeat(20),
      },
      {
        ts: 1020,
        chainId: 43113,
        blockNumber: 3,
        txHash: "0x" + "03".padStart(64, "0"),
        logIndex: 0,
        userOpHash: "0x" + "33".repeat(32),
        sender: sender2,
        paymaster: "0x" + "cc".repeat(20),
        nonce: "0",
        success: true,
        actualGasCostWei: "300",
        actualGasUsed: "30",
        bundler: "0x" + "dd".repeat(20),
      },
    ]);

    (server as any).userOps.ingestPaymasterEvents([
      {
        ts: 1000,
        chainId: 43113,
        blockNumber: 1,
        txHash: "0x" + "01".padStart(64, "0"),
        logIndex: 1,
        sender: sender1,
        userOpHash: "0x" + "11".repeat(32),
        mode: "opSucceeded",
        actualGasCostWei: "100",
        actualUserOpFeePerGas: "1",
        feeAmount: "50",
      },
      {
        ts: 1010,
        chainId: 43113,
        blockNumber: 2,
        txHash: "0x" + "02".padStart(64, "0"),
        logIndex: 1,
        sender: sender1,
        userOpHash: "0x" + "22".repeat(32),
        mode: "opReverted",
        actualGasCostWei: "200",
        actualUserOpFeePerGas: "1",
        feeAmount: "60",
      },
      {
        ts: 1020,
        chainId: 43113,
        blockNumber: 3,
        txHash: "0x" + "03".padStart(64, "0"),
        logIndex: 1,
        sender: sender2,
        userOpHash: "0x" + "33".repeat(32),
        mode: "opSucceeded",
        actualGasCostWei: "300",
        actualUserOpFeePerGas: "1",
        feeAmount: "70",
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    await server.stop();
  });

  it("aggregates per-owner and per-sender metrics", async () => {
    const body = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { authorization: "Bearer test_token" },
    }).then((r) => r.json());

    expect(Array.isArray(body.owners)).toBe(true);
    expect(Array.isArray(body.senders)).toBe(true);

    const o1 = body.owners.find((o: any) => String(o.owner).toLowerCase() === owner1.toLowerCase());
    expect(o1).toBeTruthy();
    expect(o1.senders.map((s: string) => s.toLowerCase())).toContain(sender1.toLowerCase());
    expect(o1.total).toBe(2);
    expect(o1.succeeded).toBe(1);
    expect(o1.failed).toBe(1);
    expect(o1.totalActualGasCostWei).toBe("300");
    expect(o1.totalFeeAmount).toBe("110");

    const s1 = body.senders.find((s: any) => String(s.sender).toLowerCase() === sender1.toLowerCase());
    expect(s1).toBeTruthy();
    expect(String(s1.owner).toLowerCase()).toBe(owner1.toLowerCase());
    expect(s1.total).toBe(2);
    expect(s1.succeeded).toBe(1);
    expect(s1.failed).toBe(1);
    expect(s1.totalActualGasCostWei).toBe("300");
    expect(s1.totalFeeAmount).toBe("110");

    const s2 = body.senders.find((s: any) => String(s.sender).toLowerCase() === sender2.toLowerCase());
    expect(s2).toBeTruthy();
    expect(String(s2.owner).toLowerCase()).toBe(owner2.toLowerCase());
    expect(s2.total).toBe(1);
    expect(s2.succeeded).toBe(1);
    expect(s2.failed).toBe(0);
    expect(s2.totalActualGasCostWei).toBe("300");
    expect(s2.totalFeeAmount).toBe("70");
  });
});

