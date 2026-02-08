import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";

import { OnChainIndexer } from "../src/chain/indexer";
import { UserOpAnalyticsStore } from "../src/stores/UserOpAnalyticsStore";

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gasless-swap-indexer-test-"));
}

describe("paymaster_monitor/server on-chain indexer (file-based)", () => {
  it("indexes EntryPoint + Paymaster events and persists NDJSON", async () => {
    const dataDir = mkTempDir();

    const entryPoint = "0x1111111111111111111111111111111111111111";
    const paymaster = "0x2222222222222222222222222222222222222222";
    const bundler = "0x3333333333333333333333333333333333333333";
    const sender = "0x4444444444444444444444444444444444444444";

    const entryIface = new ethers.utils.Interface([
      "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
    ]);
    const paymasterIface = new ethers.utils.Interface([
      "event PostOpHandled(address indexed sender,bytes32 indexed userOpHash,uint8 mode,uint256 actualGasCostWei,uint256 actualUserOpFeePerGas,uint256 feeAmount)",
    ]);

    const blockNumber = 10;
    const ts = 1_700_000_000; // fixed timestamp
    const txHash = ("0x" + "aa".repeat(32)) as any;
    const userOpHash = ethers.utils.hexlify(ethers.utils.randomBytes(32)) as any;

    const feeAmount = ethers.utils.parseEther("0.01");
    const gasCostWei = ethers.utils.parseEther("0.001");
    const gasUsed = ethers.BigNumber.from(123456);
    const nonce = ethers.BigNumber.from(7);

    const epEncoded = entryIface.encodeEventLog(entryIface.getEvent("UserOperationEvent"), [
      userOpHash,
      sender,
      paymaster,
      nonce,
      true,
      gasCostWei,
      gasUsed,
    ]);
    const pmEncoded = paymasterIface.encodeEventLog(paymasterIface.getEvent("PostOpHandled"), [
      sender,
      userOpHash,
      0,
      gasCostWei,
      1,
      feeAmount,
    ]);

    const entryLog = {
      address: entryPoint,
      topics: epEncoded.topics,
      data: epEncoded.data,
      blockNumber,
      transactionHash: txHash,
      logIndex: 1,
    } as any;

    const postLog = {
      address: paymaster,
      topics: pmEncoded.topics,
      data: pmEncoded.data,
      blockNumber,
      transactionHash: txHash,
      logIndex: 2,
    } as any;

    const provider = {
      getNetwork: async () => ({ chainId: 31337, name: "local" }),
      getBlockNumber: async () => blockNumber,
      getLogs: async (filter: any) => {
        if (String(filter.address).toLowerCase() === entryPoint.toLowerCase()) return [entryLog];
        if (String(filter.address).toLowerCase() === paymaster.toLowerCase()) return [postLog];
        return [];
      },
      getBlock: async (_bn: number) => ({ timestamp: ts }),
      getTransaction: async (_hash: string) => ({ from: bundler }),
    } as any;

    const store = new UserOpAnalyticsStore({ max: 100 });
    const indexer = new OnChainIndexer(
      {
        provider,
        entryPoint,
        paymaster,
        entryPointInterface: entryIface,
        paymasterInterface: paymasterIface,
        dataDir,
        pollIntervalSec: 1,
        lookbackBlocks: 1000,
        maxBlockRange: 2000,
        retentionMax: 1000,
      },
      store,
    );

    await indexer.syncOnce();
    await indexer.stop();

    const summary = store.metricsSummary();
    expect(summary.total).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.totalFeeAmount).toBe(feeAmount.toString());
    expect(summary.totalActualGasCostWei).toBe(gasCostWei.toString());

    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    const entryFile = path.join(dataDir, "chain", "entrypoint_userops", `${day}.ndjson`);
    const postFile = path.join(dataDir, "chain", "paymaster_postops", `${day}.ndjson`);

    expect(fs.readFileSync(entryFile, "utf8")).toContain(String(userOpHash));
    expect(fs.readFileSync(postFile, "utf8")).toContain(String(userOpHash));

    const userops = store.listUserOps({ limit: 10 });
    expect(userops.length).toBe(1);
    expect(userops[0].bundler?.toLowerCase()).toBe(bundler.toLowerCase());
    expect(userops[0].feeAmount).toBe(feeAmount.toString());
  });
});

