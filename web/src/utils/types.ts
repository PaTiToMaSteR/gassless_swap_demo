export type HexString = `0x${string}`;

export type BundlerInstance = {
  id: string;
  name: string;
  rpcUrl: string;
  address?: HexString;
  status: "UP" | "DOWN" | "STOPPED";
  policy: {
    strict?: boolean;
    minPriorityFeeGwei?: number;
    minMaxFeeGwei?: number;
    minValidUntilSeconds?: number;
    delayMs?: number;
    failureRate?: number;
  };
  lastSeen?: number;
  spawned: boolean;
};

export type Deployments = {
  chainId: number;
  entryPoint: HexString;
  simpleAccountFactory: HexString;
  paymaster: HexString;
  router: HexString;
  tokenIn: HexString;
  tokenOut: HexString;
};

export type QuoteRequest = {
  chainId?: number;
  tokenIn: HexString;
  tokenOut: HexString;
  amountIn: string;
  slippageBps?: number;
  sender: HexString;
};

export type Quote = {
  quoteId: string;
  chainId: number;
  createdAt: number;
  expiresAt: number;
  deadline: number;
  tokenIn: HexString;
  tokenOut: HexString;
  sender: HexString;
  amountIn: string;
  amountOut: string;
  minOut: string;
  route: {
    router: HexString;
    calldata: HexString;
  };
};

export type SwapStep =
  | "idle"
  | "connecting"
  | "quoting"
  | "building"
  | "signing"
  | "submitting"
  | "confirming"
  | "success"
  | "failed";

export type UserOpV07 = {
  sender: HexString;
  nonce: HexString;
  factory?: HexString;
  factoryData?: HexString;
  callData: HexString;
  callGasLimit: HexString;
  verificationGasLimit: HexString;
  preVerificationGas: HexString;
  maxFeePerGas: HexString;
  maxPriorityFeePerGas: HexString;
  paymaster?: HexString;
  paymasterVerificationGasLimit?: HexString;
  paymasterPostOpGasLimit?: HexString;
  paymasterData?: HexString;
  signature: HexString;
  eip7702Auth?: unknown | null;
};

