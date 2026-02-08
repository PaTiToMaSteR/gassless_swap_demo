export type HexString = `0x${string}`;

export type BundlerPolicyConfig = {
  strict?: boolean;
  minPriorityFeeGwei?: number;
  minMaxFeeGwei?: number;
  minValidUntilSeconds?: number;

  // demo-only knobs (used mainly by bundler2 instances)
  delayMs?: number;
  failureRate?: number; // 0..1
};

export type BundlerObservabilityConfig = {
  monitorUrl?: string;
  service?: string;
};

export type BundlerConfig = {
  // MetaMask-test-bundler-shaped core fields (kept simple for configs/admin spawn)
  network: string; // RPC URL
  entryPoint: string;
  port: string;
  beneficiary: string;
  minBalance: string;
  mnemonic?: string; // path to mnemonic file

  // bundling loop
  autoBundleInterval: number; // seconds
  autoBundleMempoolSize: number; // trigger if mempool >= this
  maxBundleGas: number;

  // safety toggles
  unsafe?: boolean;

  // our extensions
  policy?: BundlerPolicyConfig;
  observability?: BundlerObservabilityConfig;
};

export type EIP7702Authorization = {
  chainId: HexString;
  address: HexString;
  nonce: HexString;
  v: HexString;
  r: HexString;
  s: HexString;
};

// ERC-4337 v0.7 "unpacked" user operation (JSON-RPC shape)
export type RpcUserOperationV07 = {
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
  eip7702Auth?: EIP7702Authorization | null;
};

export type PackedUserOperationV07 = {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  accountGasLimits: string; // bytes32
  preVerificationGas: string;
  gasFees: string; // bytes32
  paymasterAndData: string;
  signature: string;
};

export type UserOperationByHashResponse = {
  userOperation: RpcUserOperationV07;
  entryPoint: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
};

export type UserOperationReceipt = {
  userOpHash: string;
  sender: string;
  nonce: string;
  actualGasCost: string;
  actualGasUsed: string;
  success: boolean;
  logs: any[];
  receipt: any;
};

