export type LogLevel = "debug" | "info" | "warn" | "error";

export type BundlerInstance = {
  id: string;
  name: string;
  rpcUrl: string;
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

export type MetricsSummary = {
  startedAt: number;
  sessions: { web: number; admin: number; total: number };
  uniqueOwners: number;
  bundlersUp: number;
  bundlersTotal: number;
  logsCount: number;
  userOps?: {
    total: number;
    succeeded: number;
    failed: number;
    uniqueSenders: number;
    totalActualGasCostWei: string;
    totalFeeAmount: string;
  };
};

export type PaymasterStatus = {
  chainId: number;
  rpcUrl: string;
  addresses: any;
  entryPointDepositWei: string;
  paymasterEthBalanceWei: string;
  tokenOutBalanceWei: string;
  tokenInBalanceWei: string;
  policy: any;
  counters: any;
};

export type LogEvent = {
  ts: number;
  level: LogLevel;
  service: string;
  msg: string;
  requestId?: string;
  sessionId?: string;
  quoteId?: string;
  userOpHash?: string;
  sender?: string;
  owner?: string;
  txHash?: string;
  chainId?: number;
  meta?: Record<string, unknown>;
};

export type UserOpSummary = {
  ts: number;
  chainId: number;
  blockNumber: number;
  txHash: string;
  userOpHash: string;
  sender: string;
  paymaster: string;
  bundler?: string;
  nonce: string;
  success: boolean;
  actualGasCostWei: string;
  actualGasUsed: string;
  feeAmount?: string;
  postOpMode?: string;
};

export type SenderMetrics = {
  sender: string;
  owner?: string;
  firstSeenMs?: number;
  lastSeenMs?: number;
  total: number;
  succeeded: number;
  failed: number;
  lastOpTs?: number;
  totalActualGasCostWei: string;
  totalFeeAmount: string;
};

export type OwnerMetrics = {
  owner: string;
  firstSeenMs: number;
  lastSeenMs: number;
  senders: string[];
  total: number;
  succeeded: number;
  failed: number;
  lastOpTs?: number;
  totalActualGasCostWei: string;
  totalFeeAmount: string;
};

export type UsersResponse = {
  owners: OwnerMetrics[];
  senders: SenderMetrics[];
};
