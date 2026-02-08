import { ethers } from "ethers";

import type { PackedUserOperationV07 } from "./types";

export type GasOverheads = {
  fixed: number;
  perUserOp: number;
  perUserOpWord: number;
  zeroByte: number;
  nonZeroByte: number;
  bundleSize: number;
  sigSize: number;
};

export const DefaultGasOverheads: GasOverheads = {
  fixed: 21_000,
  perUserOp: 18_300,
  perUserOpWord: 4,
  zeroByte: 4,
  nonZeroByte: 16,
  bundleSize: 1,
  sigSize: 65,
};

const PackedUserOpTuple =
  "tuple(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)";

export function calcPreVerificationGasV07(
  userOp: Omit<PackedUserOperationV07, "signature"> & { signature?: string },
  overheads?: Partial<GasOverheads>,
): number {
  const ov = { ...DefaultGasOverheads, ...(overheads ?? {}) };
  const signature = userOp.signature ?? ethers.utils.hexlify(Buffer.alloc(ov.sigSize, 1));

  const packedForGas = ethers.utils.defaultAbiCoder.encode([PackedUserOpTuple], [
    {
      ...userOp,
      signature,
      // dummy value to avoid missing field issues (this value itself is included in calldata cost)
      preVerificationGas: userOp.preVerificationGas ?? "0x0",
    },
  ]);

  const bytes = ethers.utils.arrayify(packedForGas);
  const lengthInWord = Math.ceil(bytes.length / 32);
  const callDataCost = bytes.reduce((sum, b) => sum + (b === 0 ? ov.zeroByte : ov.nonZeroByte), 0);

  return Math.round(callDataCost + ov.fixed / ov.bundleSize + ov.perUserOp + ov.perUserOpWord * lengthInWord);
}

