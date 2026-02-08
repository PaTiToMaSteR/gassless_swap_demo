import { BigNumber, ethers } from "ethers";

import type { PackedUserOperationV07, RpcUserOperationV07 } from "./types";
import { RpcError, RpcErrorCodes } from "./rpcErrors";

const HEX_REGEX = /^0x[a-fA-F0-9]*$/i;

function requireHex(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.match(HEX_REGEX) == null) {
    throw new RpcError(`Invalid hex value for ${field}`, RpcErrorCodes.InvalidParams);
  }
}

function requireAddress(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !ethers.utils.isAddress(value)) {
    throw new RpcError(`Invalid address for ${field}`, RpcErrorCodes.InvalidParams);
  }
}

function asHexOrZero(value: string | undefined): string {
  if (!value) return "0x";
  return value;
}

function packUint128Pair(high: string, low: string): string {
  const highHex = ethers.utils.hexZeroPad(high, 16);
  const lowHex = ethers.utils.hexZeroPad(low, 16);
  return ethers.utils.hexConcat([highHex, lowHex]);
}

export function packUserOpV07(userOp: RpcUserOperationV07): PackedUserOperationV07 {
  requireAddress(userOp.sender, "sender");
  requireHex(userOp.nonce, "nonce");
  requireHex(userOp.callData, "callData");
  requireHex(userOp.callGasLimit, "callGasLimit");
  requireHex(userOp.verificationGasLimit, "verificationGasLimit");
  requireHex(userOp.preVerificationGas, "preVerificationGas");
  requireHex(userOp.maxFeePerGas, "maxFeePerGas");
  requireHex(userOp.maxPriorityFeePerGas, "maxPriorityFeePerGas");
  requireHex(userOp.signature, "signature");

  if ((userOp.factory && !userOp.factoryData) || (!userOp.factory && userOp.factoryData)) {
    throw new RpcError("factory and factoryData must be provided together", RpcErrorCodes.InvalidParams);
  }
  if (userOp.factory) requireAddress(userOp.factory, "factory");
  if (userOp.factoryData) requireHex(userOp.factoryData, "factoryData");

  if ((userOp.paymaster && !userOp.paymasterData) === false) {
    // paymasterData is optional even if paymaster is present (empty bytes), but if paymasterData is provided ensure it's hex
  }
  if (userOp.paymaster) requireAddress(userOp.paymaster, "paymaster");
  if (userOp.paymasterVerificationGasLimit)
    requireHex(userOp.paymasterVerificationGasLimit, "paymasterVerificationGasLimit");
  if (userOp.paymasterPostOpGasLimit)
    requireHex(userOp.paymasterPostOpGasLimit, "paymasterPostOpGasLimit");
  if (userOp.paymasterData) requireHex(userOp.paymasterData, "paymasterData");

  const initCode =
    userOp.factory != null ? ethers.utils.hexConcat([userOp.factory, userOp.factoryData ?? "0x"]) : "0x";

  const accountGasLimits = packUint128Pair(userOp.verificationGasLimit, userOp.callGasLimit);
  const gasFees = packUint128Pair(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas);

  const paymasterAndData =
    userOp.paymaster != null && userOp.paymaster !== ethers.constants.AddressZero
      ? ethers.utils.hexConcat([
          userOp.paymaster,
          ethers.utils.hexZeroPad(userOp.paymasterVerificationGasLimit ?? "0x0", 16),
          ethers.utils.hexZeroPad(userOp.paymasterPostOpGasLimit ?? "0x0", 16),
          asHexOrZero(userOp.paymasterData),
        ])
      : "0x";

  return {
    sender: ethers.utils.getAddress(userOp.sender),
    nonce: BigNumber.from(userOp.nonce).toHexString(),
    initCode,
    callData: userOp.callData,
    accountGasLimits,
    preVerificationGas: BigNumber.from(userOp.preVerificationGas).toHexString(),
    gasFees,
    paymasterAndData,
    signature: userOp.signature,
  };
}

export function unpackUserOpV07(packed: PackedUserOperationV07): RpcUserOperationV07 {
  const accountGasLimits = ethers.utils.arrayify(packed.accountGasLimits);
  const gasFees = ethers.utils.arrayify(packed.gasFees);

  const verificationGasLimit = ethers.utils.hexlify(accountGasLimits.slice(0, 16));
  const callGasLimit = ethers.utils.hexlify(accountGasLimits.slice(16, 32));

  const maxPriorityFeePerGas = ethers.utils.hexlify(gasFees.slice(0, 16));
  const maxFeePerGas = ethers.utils.hexlify(gasFees.slice(16, 32));

  let factory: string | undefined;
  let factoryData: string | undefined;
  if (packed.initCode && packed.initCode !== "0x" && packed.initCode.length >= 42) {
    factory = ethers.utils.getAddress(ethers.utils.hexDataSlice(packed.initCode, 0, 20));
    factoryData = ethers.utils.hexDataSlice(packed.initCode, 20);
  }

  let paymaster: string | undefined;
  let paymasterVerificationGasLimit: string | undefined;
  let paymasterPostOpGasLimit: string | undefined;
  let paymasterData: string | undefined;
  if (packed.paymasterAndData && packed.paymasterAndData !== "0x" && packed.paymasterAndData.length >= 2 + 52 * 2) {
    paymaster = ethers.utils.getAddress(ethers.utils.hexDataSlice(packed.paymasterAndData, 0, 20));
    paymasterVerificationGasLimit = ethers.utils.hexlify(
      ethers.utils.hexDataSlice(packed.paymasterAndData, 20, 36),
    );
    paymasterPostOpGasLimit = ethers.utils.hexlify(ethers.utils.hexDataSlice(packed.paymasterAndData, 36, 52));
    paymasterData = ethers.utils.hexDataSlice(packed.paymasterAndData, 52);
  }

  return {
    sender: ethers.utils.getAddress(packed.sender) as any,
    nonce: BigNumber.from(packed.nonce).toHexString() as any,
    factory: factory as any,
    factoryData: factoryData as any,
    callData: packed.callData as any,
    callGasLimit: BigNumber.from(callGasLimit).toHexString() as any,
    verificationGasLimit: BigNumber.from(verificationGasLimit).toHexString() as any,
    preVerificationGas: BigNumber.from(packed.preVerificationGas).toHexString() as any,
    maxFeePerGas: BigNumber.from(maxFeePerGas).toHexString() as any,
    maxPriorityFeePerGas: BigNumber.from(maxPriorityFeePerGas).toHexString() as any,
    paymaster: paymaster as any,
    paymasterVerificationGasLimit: paymasterVerificationGasLimit as any,
    paymasterPostOpGasLimit: paymasterPostOpGasLimit as any,
    paymasterData: paymasterData as any,
    signature: packed.signature as any,
    eip7702Auth: null,
  };
}

const MASK_48 = BigNumber.from("0xffffffffffff");

export function parseValidationData(validationData: string): { validAfter: number; validUntil: number } {
  const bn = BigNumber.from(validationData);
  const validUntil = bn.shr(160).and(MASK_48).toNumber();
  const validAfter = bn.shr(160 + 48).and(MASK_48).toNumber();
  return {
    validAfter,
    validUntil: validUntil === 0 ? Number.MAX_SAFE_INTEGER : validUntil,
  };
}
