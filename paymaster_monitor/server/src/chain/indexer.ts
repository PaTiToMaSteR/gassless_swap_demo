import fs from "node:fs";
import path from "node:path";

import { ethers } from "ethers";

import type { EntryPointUserOperationEvent, PaymasterPostOpHandledEvent, TransactionSummary } from "../types";
import { NdjsonDailyWriter } from "../stores/NdjsonDailyWriter";
import { UserOpAnalyticsStore } from "../stores/UserOpAnalyticsStore";
import { WalletAnalyticsStore } from "../stores/WalletAnalyticsStore";

type LoggerFn = (level: "debug" | "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;

type IndexerState = {
  chainId: number;
  entryPoint: string;
  paymaster: string;
  lastProcessedBlock: number;
  updatedAt: number; // ts sec
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function readJsonFile(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readAbi(abisDir: string, name: string): any {
  return readJsonFile(path.join(abisDir, `${name}.abi.json`));
}

function coerceEntryPointEvent(raw: unknown): EntryPointUserOperationEvent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.ts !== "number" || typeof raw.chainId !== "number") return null;
  if (typeof raw.blockNumber !== "number" || typeof raw.logIndex !== "number") return null;
  if (typeof raw.txHash !== "string" || typeof raw.userOpHash !== "string") return null;
  if (typeof raw.sender !== "string" || typeof raw.paymaster !== "string") return null;
  if (typeof raw.nonce !== "string" || typeof raw.actualGasCostWei !== "string" || typeof raw.actualGasUsed !== "string") return null;
  if (typeof raw.success !== "boolean") return null;
  return {
    ts: raw.ts,
    chainId: raw.chainId,
    blockNumber: raw.blockNumber,
    txHash: raw.txHash as any,
    logIndex: raw.logIndex,
    userOpHash: raw.userOpHash as any,
    sender: raw.sender as any,
    paymaster: raw.paymaster as any,
    nonce: raw.nonce,
    success: raw.success,
    actualGasCostWei: raw.actualGasCostWei,
    actualGasUsed: raw.actualGasUsed,
    bundler: typeof raw.bundler === "string" ? (raw.bundler as any) : undefined,
  };
}

function coercePaymasterEvent(raw: unknown): PaymasterPostOpHandledEvent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.ts !== "number" || typeof raw.chainId !== "number") return null;
  if (typeof raw.blockNumber !== "number" || typeof raw.logIndex !== "number") return null;
  if (typeof raw.txHash !== "string" || typeof raw.userOpHash !== "string") return null;
  if (typeof raw.sender !== "string") return null;
  if (typeof raw.mode !== "string") return null;
  if (typeof raw.actualGasCostWei !== "string" || typeof raw.actualUserOpFeePerGas !== "string" || typeof raw.feeAmount !== "string") return null;

  const mode = raw.mode as PaymasterPostOpHandledEvent["mode"];
  if (!["opSucceeded", "opReverted", "postOpReverted", "unknown"].includes(mode)) return null;

  return {
    ts: raw.ts,
    chainId: raw.chainId,
    blockNumber: raw.blockNumber,
    txHash: raw.txHash as any,
    logIndex: raw.logIndex,
    sender: raw.sender as any,
    userOpHash: raw.userOpHash as any,
    mode,
    actualGasCostWei: raw.actualGasCostWei,
    actualUserOpFeePerGas: raw.actualUserOpFeePerGas,
    feeAmount: raw.feeAmount,
  };
}

function modeFromPostOpMode(value: unknown): PaymasterPostOpHandledEvent["mode"] {
  try {
    const n = ethers.BigNumber.from(value).toNumber();
    if (n === 0) return "opSucceeded";
    if (n === 1) return "opReverted";
    if (n === 2) return "postOpReverted";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export type OnChainIndexerConfig = {
  provider: ethers.providers.JsonRpcProvider;
  entryPoint: string;
  paymaster: string;
  entryPointInterface: ethers.utils.Interface;
  paymasterInterface: ethers.utils.Interface;
  dataDir: string;
  pollIntervalSec: number;
  lookbackBlocks: number;
  maxBlockRange: number;
  retentionMax: number;
  logger?: LoggerFn;
};

export class OnChainIndexer {
  private readonly statePath: string;
  private readonly entryWriter: NdjsonDailyWriter<EntryPointUserOperationEvent>;
  private readonly postWriter: NdjsonDailyWriter<PaymasterPostOpHandledEvent>;

  private readonly blockTsCache = new Map<number, number>();
  private readonly txFromCache = new Map<string, string>();

  private timer?: NodeJS.Timeout;
  private chainId = 0;
  private lastProcessedBlock = 0;
  private initialized = false;

  constructor(
    readonly cfg: OnChainIndexerConfig,
    readonly store: UserOpAnalyticsStore,
    readonly walletStore?: WalletAnalyticsStore
  ) {
    const chainDir = path.join(cfg.dataDir, "chain");
    this.statePath = path.join(chainDir, "indexer_state.json");
    this.entryWriter = new NdjsonDailyWriter<EntryPointUserOperationEvent>({
      dir: path.join(chainDir, "entrypoint_userops"),
      coerce: coerceEntryPointEvent,
    });
    this.postWriter = new NdjsonDailyWriter<PaymasterPostOpHandledEvent>({
      dir: path.join(chainDir, "paymaster_postops"),
      coerce: coercePaymasterEvent,
    });
  }

  static async fromDeployments(args: {
    rpcUrl: string;
    deploymentsPath: string;
    dataDir: string;
    pollIntervalSec: number;
    lookbackBlocks: number;
    maxBlockRange: number;
    retentionMax: number;
    logger?: LoggerFn;
    store: UserOpAnalyticsStore;
    walletStore?: WalletAnalyticsStore;
  }): Promise<OnChainIndexer> {
    const deployments = readJsonFile(args.deploymentsPath) as { entryPoint: string; paymaster: string };
    const abisDir = path.join(path.dirname(args.deploymentsPath), "abis");
    const provider = new ethers.providers.JsonRpcProvider(args.rpcUrl);

    const entryPointInterface = new ethers.utils.Interface(readAbi(abisDir, "EntryPoint"));
    const paymasterInterface = new ethers.utils.Interface(readAbi(abisDir, "GaslessSwapPaymaster"));

    const indexer = new OnChainIndexer(
      {
        provider,
        entryPoint: deployments.entryPoint,
        paymaster: deployments.paymaster,
        entryPointInterface,
        paymasterInterface,
        dataDir: args.dataDir,
        pollIntervalSec: args.pollIntervalSec,
        lookbackBlocks: args.lookbackBlocks,
        maxBlockRange: args.maxBlockRange,
        retentionMax: args.retentionMax,
        logger: args.logger,
      },
      args.store,
      args.walletStore
    );
    await indexer.init();
    return indexer;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this._init();
  }

  async start(): Promise<void> {
    await this.init();
    const intervalMs = Math.max(1, this.cfg.pollIntervalSec) * 1000;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.syncOnce(), intervalMs);
    void this.syncOnce();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([this.entryWriter.flush(), this.postWriter.flush()]);
  }

  async syncOnce(): Promise<void> {
    await this.init();
    try {
      const latest = await this.cfg.provider.getBlockNumber();
      let from = Math.max(0, this.lastProcessedBlock + 1);
      if (this.lastProcessedBlock === 0) {
        from = Math.max(0, latest - Math.max(0, this.cfg.lookbackBlocks));
      }

      while (from <= latest) {
        const to = Math.min(latest, from + Math.max(1, this.cfg.maxBlockRange) - 1);
        await this._syncRange(from, to);

        if (this.walletStore) {
          await this._syncGlobalTraffic(from, to);
        }

        this.lastProcessedBlock = to;
        this._writeState();
        from = to + 1;
      }
    } catch (err: any) {
      this.cfg.logger?.("warn", "indexer sync failed", { error: err?.message ?? String(err) });
    }
  }

  private async _syncGlobalTraffic(from: number, to: number): Promise<void> {
    for (let i = from; i <= to; i++) {
      try {
        const block = await this.cfg.provider.getBlockWithTransactions(i);
        if (!block) continue;

        const seenAddresses = new Set<string>();
        const txSummaries: TransactionSummary[] = [];

        for (const tx of block.transactions) {
          seenAddresses.add(tx.from.toLowerCase());
          if (tx.to) seenAddresses.add(tx.to.toLowerCase());

          txSummaries.push({
            hash: tx.hash as any,
            blockNumber: block.number,
            ts: block.timestamp,
            from: tx.from as any,
            to: tx.to as any,
            value: tx.value.toString(),
            gasUsed: "0",
            gasPrice: (tx.gasPrice || 0).toString(),
            success: true,
          });
        }

        for (const addr of seenAddresses) {
          try {
            const [bal, count] = await Promise.all([
              this.cfg.provider.getBalance(addr),
              this.cfg.provider.getTransactionCount(addr)
            ]);
            this.walletStore!.updateWallet({
              address: addr as any,
              balance: bal.toString(),
              txCount: count,
              lastSeen: block.timestamp
            });
          } catch { /* ignore */ }
        }
        this.walletStore!.addTransactions(txSummaries);
      } catch (err) {
        this.cfg.logger?.("debug", `global indexing failed for block ${i}`, { error: String(err) });
      }
    }
  }

  // --- internals ---

  private async _init(): Promise<void> {
    const net = await this.cfg.provider.getNetwork();
    this.chainId = net.chainId;

    const restoredEntry = this.entryWriter.loadRecent(this.cfg.retentionMax);
    const restoredPost = this.postWriter.loadRecent(this.cfg.retentionMax);
    this.store.ingestEntryPointEvents(restoredEntry);
    this.store.ingestPaymasterEvents(restoredPost);

    const state = this._readState();
    if (state && state.chainId === this.chainId && state.entryPoint.toLowerCase() === this.cfg.entryPoint.toLowerCase() && state.paymaster.toLowerCase() === this.cfg.paymaster.toLowerCase()) {
      this.lastProcessedBlock = state.lastProcessedBlock;
    }

    this.cfg.logger?.("info", "indexer ready", {
      chainId: this.chainId,
      entryPoint: this.cfg.entryPoint,
      paymaster: this.cfg.paymaster,
      lastProcessedBlock: this.lastProcessedBlock,
    });
  }

  private _readState(): IndexerState | null {
    try {
      const raw = readJsonFile(this.statePath) as any;
      if (!isRecord(raw)) return null;
      if (typeof raw.chainId !== "number" || typeof raw.entryPoint !== "string" || typeof raw.paymaster !== "string" || typeof raw.lastProcessedBlock !== "number") return null;
      return {
        chainId: raw.chainId,
        entryPoint: raw.entryPoint,
        paymaster: raw.paymaster,
        lastProcessedBlock: raw.lastProcessedBlock,
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
      };
    } catch {
      return null;
    }
  }

  private _writeState(): void {
    const dir = path.dirname(this.statePath);
    fs.mkdirSync(dir, { recursive: true });
    const state: IndexerState = {
      chainId: this.chainId,
      entryPoint: this.cfg.entryPoint,
      paymaster: this.cfg.paymaster,
      lastProcessedBlock: this.lastProcessedBlock,
      updatedAt: nowSec(),
    };
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }

  private async _syncRange(fromBlock: number, toBlock: number): Promise<void> {
    const epTopic0 = this.cfg.entryPointInterface.getEventTopic("UserOperationEvent");
    const paymasterTopic = ethers.utils.hexZeroPad(this.cfg.paymaster, 32);

    const entryLogs = await this.cfg.provider.getLogs({
      address: this.cfg.entryPoint,
      topics: [epTopic0, null, null, paymasterTopic],
      fromBlock,
      toBlock,
    });

    const pmTopic0 = this.cfg.paymasterInterface.getEventTopic("PostOpHandled");
    const postLogs = await this.cfg.provider.getLogs({
      address: this.cfg.paymaster,
      topics: [pmTopic0],
      fromBlock,
      toBlock,
    });

    const entryEvents: EntryPointUserOperationEvent[] = [];
    for (const l of entryLogs) {
      try {
        const parsed = this.cfg.entryPointInterface.parseLog(l);
        const ts = await this._blockTimestamp(l.blockNumber);
        const bundler = await this._txFrom(l.transactionHash);
        entryEvents.push({
          ts,
          chainId: this.chainId,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash as any,
          logIndex: l.logIndex,
          userOpHash: parsed.args.userOpHash as any,
          sender: parsed.args.sender as any,
          paymaster: parsed.args.paymaster as any,
          nonce: ethers.BigNumber.from(parsed.args.nonce).toString(),
          success: Boolean(parsed.args.success),
          actualGasCostWei: ethers.BigNumber.from(parsed.args.actualGasCost).toString(),
          actualGasUsed: ethers.BigNumber.from(parsed.args.actualGasUsed).toString(),
          bundler: bundler ? (bundler as any) : undefined,
        });
      } catch { /* ignore */ }
    }

    const postEvents: PaymasterPostOpHandledEvent[] = [];
    for (const l of postLogs) {
      try {
        const parsed = this.cfg.paymasterInterface.parseLog(l);
        const ts = await this._blockTimestamp(l.blockNumber);
        postEvents.push({
          ts,
          chainId: this.chainId,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash as any,
          logIndex: l.logIndex,
          sender: parsed.args.sender as any,
          userOpHash: parsed.args.userOpHash as any,
          mode: modeFromPostOpMode(parsed.args.mode),
          actualGasCostWei: ethers.BigNumber.from(parsed.args.actualGasCostWei).toString(),
          actualUserOpFeePerGas: ethers.BigNumber.from(parsed.args.actualUserOpFeePerGas).toString(),
          feeAmount: ethers.BigNumber.from(parsed.args.feeAmount).toString(),
        });
      } catch { /* ignore */ }
    }

    if (entryEvents.length > 0) {
      this.store.ingestEntryPointEvents(entryEvents);
      void this.entryWriter.append(entryEvents);
    }
    if (postEvents.length > 0) {
      this.store.ingestPaymasterEvents(postEvents);
      void this.postWriter.append(postEvents);
    }
  }

  private async _blockTimestamp(blockNumber: number): Promise<number> {
    const cached = this.blockTsCache.get(blockNumber);
    if (cached) return cached;
    const b = await this.cfg.provider.getBlock(blockNumber);
    const ts = typeof b?.timestamp === "number" ? b.timestamp : nowSec();
    this.blockTsCache.set(blockNumber, ts);
    return ts;
  }

  private async _txFrom(txHash: string): Promise<string | undefined> {
    const cached = this.txFromCache.get(txHash);
    if (cached) return cached;
    const tx = await this.cfg.provider.getTransaction(txHash);
    const from = tx?.from;
    if (typeof from === "string") this.txFromCache.set(txHash, from);
    return from ?? undefined;
  }
}
