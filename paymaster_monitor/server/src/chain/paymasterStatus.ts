import fs from "node:fs";
import path from "node:path";

import { ethers } from "ethers";

import type { PaymasterDeployments } from "./deployments";

function readAbi(abisDir: string, name: string): any {
  const p = path.join(abisDir, `${name}.abi.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export type PaymasterStatus = {
  chainId: number;
  rpcUrl: string;
  addresses: PaymasterDeployments;
  entryPointDepositWei: string;
  paymasterEthBalanceWei: string;
  tokenOutBalanceWei: string;
  tokenInBalanceWei: string;
  policy: {
    gasBufferBps: number;
    fixedMarkupWei: string;
    minDepositWei: string;
    minDelayBetweenOpsSec: number;
  };
  counters: {
    sponsoredOps: string;
    sponsoredOpsSucceeded: string;
    sponsoredOpsReverted: string;
    totalActualGasCostWei: string;
    totalFeeAmount: string;
  };
};

function numericFieldToBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid numeric field ${fieldName}: ${value}`);
    }
    return BigInt(value);
  }

  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      throw new Error(`Invalid numeric string for ${fieldName}: ${value}`);
    }
  }

  if (value && typeof value === "object") {
    const asAny = value as Record<string, unknown>;

    if (typeof asAny.toBigInt === "function") {
      return BigInt((asAny.toBigInt as () => bigint | string | number)());
    }

    if (typeof asAny.toNumber === "function") {
      const maybeNumber = (asAny.toNumber as () => number)();
      if (Number.isFinite(maybeNumber) && Number.isInteger(maybeNumber) && maybeNumber >= 0) {
        return BigInt(maybeNumber);
      }
    }

    if (typeof asAny._hex === "string") {
      try {
        return BigInt(asAny._hex);
      } catch {
        // continue to toString fallback
      }
    }

    if (typeof asAny.toString === "function") {
      const text = String((asAny.toString as () => string)());
      if (text && text !== "[object Object]") {
        try {
          return BigInt(text);
        } catch {
          throw new Error(`Invalid toString() numeric value for ${fieldName}: ${text}`);
        }
      }
    }
  }

  throw new Error(`Unsupported numeric value for ${fieldName}`);
}

function numericFieldToString(value: unknown, fieldName: string): string {
  return numericFieldToBigInt(value, fieldName).toString();
}

function numericFieldToSafeNumber(value: unknown, fieldName: string): number {
  const big = numericFieldToBigInt(value, fieldName);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${fieldName} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(big);
}

export async function getPaymasterStatus(args: {
  rpcUrl: string;
  abisDir: string;
  deployments: PaymasterDeployments;
}): Promise<PaymasterStatus> {
  const provider = new ethers.providers.JsonRpcProvider(args.rpcUrl);
  const { chainId } = await provider.getNetwork();

  const entryPointAbi = readAbi(args.abisDir, "EntryPoint");
  const paymasterAbi = readAbi(args.abisDir, "GaslessSwapPaymaster");
  const erc20Abi = readAbi(args.abisDir, "TestERC20");

  const entryPoint = new ethers.Contract(args.deployments.entryPoint, entryPointAbi, provider);
  const paymaster = new ethers.Contract(args.deployments.paymaster, paymasterAbi, provider);
  const tokenOut = new ethers.Contract(args.deployments.tokenOut, erc20Abi, provider);
  const tokenIn = new ethers.Contract(args.deployments.tokenIn, erc20Abi, provider);

  const [depositWei, ethBalWei] = await Promise.all([
    entryPoint.balanceOf(args.deployments.paymaster) as Promise<ethers.BigNumber>,
    provider.getBalance(args.deployments.paymaster),
  ]);

  const [tokenOutBal, tokenInBal] = await Promise.all([
    tokenOut.balanceOf(args.deployments.paymaster) as Promise<ethers.BigNumber>,
    tokenIn.balanceOf(args.deployments.paymaster) as Promise<ethers.BigNumber>,
  ]);

  const [gasBufferBps, fixedMarkupWei, minDepositWei, minDelayBetweenOpsSec] = await Promise.all([
    paymaster.gasBufferBps() as Promise<ethers.BigNumber>,
    paymaster.fixedMarkupWei() as Promise<ethers.BigNumber>,
    paymaster.minDepositWei() as Promise<ethers.BigNumber>,
    paymaster.minDelayBetweenOpsSec() as Promise<ethers.BigNumber>,
  ]);

  const [sponsoredOps, sponsoredOpsSucceeded, sponsoredOpsReverted, totalActualGasCostWei, totalFeeAmount] =
    await Promise.all([
      paymaster.sponsoredOps() as Promise<ethers.BigNumber>,
      paymaster.sponsoredOpsSucceeded() as Promise<ethers.BigNumber>,
      paymaster.sponsoredOpsReverted() as Promise<ethers.BigNumber>,
      paymaster.totalActualGasCostWei() as Promise<ethers.BigNumber>,
      paymaster.totalFeeAmount() as Promise<ethers.BigNumber>,
    ]);

  return {
    chainId,
    rpcUrl: args.rpcUrl,
    addresses: args.deployments,
    entryPointDepositWei: numericFieldToString(depositWei, "entryPointDepositWei"),
    paymasterEthBalanceWei: numericFieldToString(ethBalWei, "paymasterEthBalanceWei"),
    tokenOutBalanceWei: numericFieldToString(tokenOutBal, "tokenOutBalanceWei"),
    tokenInBalanceWei: numericFieldToString(tokenInBal, "tokenInBalanceWei"),
    policy: {
      gasBufferBps: numericFieldToSafeNumber(gasBufferBps, "gasBufferBps"),
      fixedMarkupWei: numericFieldToString(fixedMarkupWei, "fixedMarkupWei"),
      minDepositWei: numericFieldToString(minDepositWei, "minDepositWei"),
      minDelayBetweenOpsSec: numericFieldToSafeNumber(minDelayBetweenOpsSec, "minDelayBetweenOpsSec"),
    },
    counters: {
      sponsoredOps: numericFieldToString(sponsoredOps, "sponsoredOps"),
      sponsoredOpsSucceeded: numericFieldToString(sponsoredOpsSucceeded, "sponsoredOpsSucceeded"),
      sponsoredOpsReverted: numericFieldToString(sponsoredOpsReverted, "sponsoredOpsReverted"),
      totalActualGasCostWei: numericFieldToString(totalActualGasCostWei, "totalActualGasCostWei"),
      totalFeeAmount: numericFieldToString(totalFeeAmount, "totalFeeAmount"),
    },
  };
}
