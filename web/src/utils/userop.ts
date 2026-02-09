import { BigNumber, ethers } from "ethers";

import type { HexString, UserOpV07 } from "./types";

const SIMPLE_ACCOUNT_ABI = ["function executeBatch(address[] dest,uint256[] value,bytes[] func)"];
const FACTORY_ABI = ["function createAccount(address owner,uint256 salt) returns (address)"];

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address to,uint256 amount) returns (bool)",
];

export function hexBn(v: BigNumber): HexString {
  return v.toHexString() as any;
}

export function packUint128Pair(high: BigNumber, low: BigNumber): HexString {
  const highHex = ethers.utils.hexZeroPad(high.toHexString(), 16);
  const lowHex = ethers.utils.hexZeroPad(low.toHexString(), 16);
  return ethers.utils.hexConcat([highHex, lowHex]) as HexString;
}

export function buildFactoryData(owner: string, salt: number): HexString {
  const iface = new ethers.utils.Interface(FACTORY_ABI);
  return iface.encodeFunctionData("createAccount", [owner, salt]) as HexString;
}

export function buildExecuteBatchCallData(args: {
  tokenIn: HexString;
  tokenOut: HexString;
  router: HexString;
  paymaster: HexString;
  amountIn: BigNumber;
  feeAmount: BigNumber;
  routerSwapCalldata: HexString;
}): HexString {
  if (!args.tokenIn) throw new Error("buildExecuteBatchCallData: tokenIn is undefined");
  if (!args.tokenOut) throw new Error("buildExecuteBatchCallData: tokenOut is undefined");
  if (!args.router) throw new Error("buildExecuteBatchCallData: router is undefined");
  if (!args.paymaster) throw new Error("buildExecuteBatchCallData: paymaster is undefined");

  const tokenIface = new ethers.utils.Interface(ERC20_ABI);
  const accountIface = new ethers.utils.Interface(SIMPLE_ACCOUNT_ABI);

  const targets = [args.tokenIn, args.router, args.tokenOut];
  const values = [0, 0, 0];
  const datas = [
    tokenIface.encodeFunctionData("approve", [args.router, args.amountIn]),
    args.routerSwapCalldata,
    tokenIface.encodeFunctionData("transfer", [args.paymaster, args.feeAmount]),
  ];
  return accountIface.encodeFunctionData("executeBatch", [targets, values, datas]) as HexString;
}

// For ERC-4337 gas estimation, some bundlers run `simulateValidation`, which executes the account's signature
// validation on-chain. If we haven't asked the user to sign yet, we still need a placeholder signature that
// does NOT revert inside typical `ECDSA.recover` implementations (v must be 27/28 and s must be low).
//
// This dummy signature is NOT meant to be accepted; it's only to avoid "invalid signature" reverts during
// simulation. The real signature is requested later and replaces this value.
export function makeNonRevertingDummySignature(): HexString {
  const r = ethers.utils.hexZeroPad("0x01", 32);
  const s = ethers.utils.hexZeroPad("0x01", 32);
  const v = "0x1b"; // 27
  return ethers.utils.hexConcat([r, s, v]) as HexString;
}

export type EIP7702Authorization = {
  chainId: HexString;
  address: HexString;
  nonce: HexString;
  v: HexString;
  r: HexString;
  s: HexString;
};

export async function signEIP7702Authorization(
  signer: ethers.Signer,
  target: string,
  nonce: number,
): Promise<EIP7702Authorization> {
  const chainId = await signer.getChainId();
  const address = target as HexString;
  const nonceHex = ethers.utils.hexValue(nonce) as HexString;
  const chainIdHex = ethers.utils.hexValue(chainId) as HexString;

  // EIP-7702 payload: rlp([chain_id, address, nonce])
  const payload = ethers.utils.RLP.encode([
    BigNumber.from(chainId).toHexString(),
    address,
    BigNumber.from(nonce).toHexString(),
  ]);

  // Magic prefix 0x05
  const hash = ethers.utils.keccak256(ethers.utils.hexConcat(["0x05", payload]));

  // Sign the digest directly.
  // Note: Most wallet providers might not support signing arbitrary 32-byte digests with 0x05 prefix.
  // For the demo, we assume the signer can handle it or we use a dev wallet.
  const sig = await (signer as any)._signingKey().signDigest(hash);

  return {
    chainId: chainIdHex,
    address,
    nonce: nonceHex === "0x0" ? "0x" : nonceHex,
    v: ethers.utils.hexValue(sig.v) as HexString,
    r: sig.r as HexString,
    s: sig.s as HexString,
  };
}

export function buildPackedUserOpV07(userOp: UserOpV07): any {
  if (!userOp.sender) throw new Error("buildPackedUserOpV07: sender is undefined");
  if (!userOp.nonce) throw new Error("buildPackedUserOpV07: nonce is undefined");
  if (!userOp.callData) throw new Error("buildPackedUserOpV07: callData is undefined");
  if (!userOp.callGasLimit) throw new Error("buildPackedUserOpV07: callGasLimit is undefined");
  if (!userOp.verificationGasLimit) throw new Error("buildPackedUserOpV07: verificationGasLimit is undefined");
  if (!userOp.preVerificationGas) throw new Error("buildPackedUserOpV07: preVerificationGas is undefined");
  if (!userOp.maxFeePerGas) throw new Error("buildPackedUserOpV07: maxFeePerGas is undefined");
  if (!userOp.maxPriorityFeePerGas) throw new Error("buildPackedUserOpV07: maxPriorityFeePerGas is undefined");

  const initCode =
    userOp.factory != null ? ethers.utils.hexConcat([userOp.factory, userOp.factoryData ?? "0x"]) : "0x";

  const accountGasLimits = packUint128Pair(BigNumber.from(userOp.verificationGasLimit), BigNumber.from(userOp.callGasLimit));
  const gasFees = packUint128Pair(BigNumber.from(userOp.maxPriorityFeePerGas), BigNumber.from(userOp.maxFeePerGas));

  const paymasterAndData =
    userOp.paymaster != null && userOp.paymaster !== ethers.constants.AddressZero
      ? ethers.utils.hexConcat([
        userOp.paymaster,
        ethers.utils.hexZeroPad(userOp.paymasterVerificationGasLimit ?? "0x0", 16),
        ethers.utils.hexZeroPad(userOp.paymasterPostOpGasLimit ?? "0x0", 16),
        userOp.paymasterData ?? "0x",
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
    // Note: eip7702Auth is passed as an extra field for the bundler to handle
    eip7702Auth: userOp.eip7702Auth,
    // Pass through factory fields for bundlers that expect unpacked inputs (like our demo bundler)
    factory: userOp.factory,
    factoryData: userOp.factoryData,
    // Pass through paymaster fields for bundlers that expect unpacked inputs
    paymaster: userOp.paymaster,
    paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit,
    paymasterData: userOp.paymasterData,
  };
}
