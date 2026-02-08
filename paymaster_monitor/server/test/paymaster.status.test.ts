import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  getNetwork: vi.fn(async () => ({ chainId: 31337 })),
  getBalance: vi.fn(async () => 123n),
  contractFactory: vi.fn(),
}));

vi.mock("ethers", () => {
  class JsonRpcProvider {
    readonly url: string;
    constructor(url: string) {
      this.url = url;
    }
    getNetwork = mock.getNetwork;
    getBalance = mock.getBalance;
  }

  function Contract(...args: unknown[]): unknown {
    return mock.contractFactory(...args);
  }

  return {
    ethers: {
      providers: { JsonRpcProvider },
      Contract,
    },
  };
});

import { getPaymasterStatus } from "../src/chain/paymasterStatus";

type Deployments = {
  chainId: number;
  entryPoint: string;
  simpleAccountFactory: string;
  paymaster: string;
  router: string;
  pool?: string;
  tokenIn: string;
  tokenOut: string;
};

describe("paymaster status numeric coercion", () => {
  let tempDir = "";
  let abisDir = "";
  let deployments: Deployments;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paymaster-status-test-"));
    abisDir = path.join(tempDir, "abis");
    fs.mkdirSync(abisDir, { recursive: true });

    for (const name of ["EntryPoint", "GaslessSwapPaymaster", "TestERC20"]) {
      fs.writeFileSync(path.join(abisDir, `${name}.abi.json`), "[]");
    }

    deployments = {
      chainId: 31337,
      entryPoint: "0x0000000000000000000000000000000000000001",
      simpleAccountFactory: "0x0000000000000000000000000000000000000002",
      paymaster: "0x0000000000000000000000000000000000000003",
      router: "0x0000000000000000000000000000000000000004",
      pool: "0x0000000000000000000000000000000000000005",
      tokenIn: "0x0000000000000000000000000000000000000006",
      tokenOut: "0x0000000000000000000000000000000000000007",
    };

    mock.contractFactory.mockImplementation((address: string) => {
      if (address === deployments.entryPoint) {
        return {
          balanceOf: async () => ({ toString: () => "1000" }),
        };
      }

      if (address === deployments.paymaster) {
        return {
          gasBufferBps: async () => 500,
          fixedMarkupWei: async () => 0n,
          minDepositWei: async () => "10",
          minDelayBetweenOpsSec: async () => 45n,
          sponsoredOps: async () => 2n,
          sponsoredOpsSucceeded: async () => "1",
          sponsoredOpsReverted: async () => ({ toString: () => "1" }),
          totalActualGasCostWei: async () => 99n,
          totalFeeAmount: async () => "1234",
        };
      }

      if (address === deployments.tokenOut) {
        return {
          balanceOf: async () => 77n,
        };
      }

      if (address === deployments.tokenIn) {
        return {
          balanceOf: async () => "88",
        };
      }

      throw new Error(`Unexpected contract address: ${address}`);
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    mock.getNetwork.mockClear();
    mock.getBalance.mockClear();
    mock.contractFactory.mockReset();
  });

  it("handles bigint/number/string values without relying on toNumber()", async () => {
    const status = await getPaymasterStatus({
      rpcUrl: "http://127.0.0.1:8545",
      abisDir,
      deployments,
    });

    expect(status.chainId).toBe(31337);
    expect(status.entryPointDepositWei).toBe("1000");
    expect(status.paymasterEthBalanceWei).toBe("123");
    expect(status.tokenOutBalanceWei).toBe("77");
    expect(status.tokenInBalanceWei).toBe("88");

    expect(status.policy.gasBufferBps).toBe(500);
    expect(status.policy.minDelayBetweenOpsSec).toBe(45);
    expect(status.policy.fixedMarkupWei).toBe("0");
    expect(status.policy.minDepositWei).toBe("10");

    expect(status.counters.sponsoredOps).toBe("2");
    expect(status.counters.sponsoredOpsSucceeded).toBe("1");
    expect(status.counters.sponsoredOpsReverted).toBe("1");
    expect(status.counters.totalActualGasCostWei).toBe("99");
    expect(status.counters.totalFeeAmount).toBe("1234");
  });
});
