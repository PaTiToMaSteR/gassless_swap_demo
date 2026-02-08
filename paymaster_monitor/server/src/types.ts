export type HexString = `0x${string}`;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  ts: number; // unix timestamp (seconds)
  level: LogLevel;
  service: string;
  msg: string;

  requestId?: string;
  sessionId?: string;
  quoteId?: string;
  userOpHash?: HexString;
  sender?: HexString;
  owner?: HexString;
  txHash?: HexString;
  chainId?: number;

  meta?: Record<string, unknown>;
};

export type BundlerPolicy = {
  strict?: boolean;
  minPriorityFeeGwei?: number;
  minMaxFeeGwei?: number;
  minValidUntilSeconds?: number;
  delayMs?: number;
  failureRate?: number;
};

export type BundlerStatus = "UP" | "DOWN" | "STOPPED";

export type BundlerInstancePublic = {
  id: string;
  name: string;
  rpcUrl: string;
  status: BundlerStatus;
  policy: BundlerPolicy;
  lastSeen?: number;
  spawned: boolean;
};

export type EntryPointUserOperationEvent = {
  ts: number;
  chainId: number;
  blockNumber: number;
  txHash: HexString;
  logIndex: number;

  userOpHash: HexString;
  sender: HexString;
  paymaster: HexString;
  nonce: string; // decimal string
  success: boolean;
  actualGasCostWei: string; // decimal string
  actualGasUsed: string; // decimal string

  bundler?: HexString; // tx.from of handleOps
  revertReason?: string;
};

export type PaymasterPostOpHandledEvent = {
  ts: number;
  chainId: number;
  blockNumber: number;
  txHash: HexString;
  logIndex: number;

  sender: HexString;
  userOpHash: HexString;
  mode: "opSucceeded" | "opReverted" | "postOpReverted" | "unknown";
  actualGasCostWei: string; // decimal string
  actualUserOpFeePerGas: string; // decimal string
  feeAmount: string; // decimal string (tokenOut wei in this demo)
};

export type UserOpSummary = {
  ts: number;
  chainId: number;
  blockNumber: number;
  txHash: HexString;

  userOpHash: HexString;
  sender: HexString;
  paymaster: HexString;
  bundler?: HexString;
  nonce: string;

  success: boolean;
  actualGasCostWei: string;
  actualGasUsed: string;

  // enriched from paymaster events (optional if not indexed yet)
  feeAmount?: string;
  postOpMode?: PaymasterPostOpHandledEvent["mode"];
  revertReason?: string;
};

export type UserOpsMetricsSummary = {
  total: number;
  succeeded: number;
  failed: number;
  uniqueSenders: number;
  totalActualGasCostWei: string;
  totalFeeAmount: string;
};

export type SenderMetrics = {
  sender: HexString;
  total: number;
  succeeded: number;
  failed: number;
  lastOpTs?: number;
  totalActualGasCostWei: string;
  totalFeeAmount: string;
};

export type OwnerMetrics = {
  owner: HexString;
  firstSeenMs: number;
  lastSeenMs: number;
  senders: HexString[];
  total: number;
  succeeded: number;
  failed: number;
  lastOpTs?: number;
  totalActualGasCostWei: string;
  totalFeeAmount: string;
};

export type TransactionSummary = {
  hash: HexString;
  blockNumber: number;
  ts: number;
  from: HexString;
  to?: HexString;
  value: string;
  gasUsed: string;
  gasPrice: string;
  success: boolean;
};

export type WalletStats = {
  address: HexString;
  balance: string;
  txCount: number;
  lastSeen: number;
};

export type UsersResponse = {
  owners: OwnerMetrics[];
  senders: Array<
    SenderMetrics & {
      firstSeenMs?: number;
      lastSeenMs?: number;
      owner?: HexString;
    }
  >;
  wallets: WalletStats[]; // Added for global indexing
};
