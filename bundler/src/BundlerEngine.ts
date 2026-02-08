import { BigNumber, ethers } from "ethers";
import Debug from "debug";

import type {
  BundlerConfig,
  PackedUserOperationV07,
  RpcUserOperationV07,
  UserOperationByHashResponse,
  UserOperationReceipt,
} from "./types";
import { RpcError, RpcErrorCodes } from "./rpcErrors";
import { packUserOpV07, parseValidationData, signEIP7702Transaction, unpackUserOpV07 } from "./packing";
import { simulateValidationV07 } from "./simulations";
import { calcPreVerificationGasV07 } from "./preVerificationGas";
import { Logger } from "./logging";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const entryPointArtifact = require("@account-abstraction/contracts/artifacts/EntryPoint.json");

const debug = Debug("gasless-swap:bundler");

type MempoolEntry = {
  userOp: RpcUserOperationV07;
  packed: PackedUserOperationV07;
  userOpHash: string;
  receivedAtMs: number;
  status: "pending" | "sent" | "mined" | "failed";
  txHash?: string;
  txReceipt?: ethers.providers.TransactionReceipt;
  eip7702Auth?: any;
};

export class BundlerEngine {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly wallet: ethers.Wallet;
  private readonly entryPoint: ethers.Contract;
  private readonly logger: Logger;
  private startedFromBlock = 0;

  private bundlingTimer?: NodeJS.Timeout;
  private bundlingInFlight = false;

  private mempool = new Map<string, MempoolEntry>();

  constructor(readonly config: BundlerConfig) {
    this.provider = new ethers.providers.JsonRpcProvider(config.network);

    const privateKey = process.env.BUNDLER_PRIVATE_KEY;
    if (!privateKey && !config.mnemonic) {
      throw new Error("Provide BUNDLER_PRIVATE_KEY env var or config.mnemonic path");
    }

    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    } else {
      // mnemonic file
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      const mnemonic = fs.readFileSync(config.mnemonic!, "utf8").trim();
      this.wallet = ethers.Wallet.fromMnemonic(mnemonic).connect(this.provider);
    }

    this.entryPoint = new ethers.Contract(config.entryPoint, entryPointArtifact.abi, this.wallet);
    this.logger = new Logger({
      service: config.observability?.service ?? "bundler",
      monitorUrl: config.observability?.monitorUrl,
    });
  }

  async start(): Promise<void> {
    const net = await this.provider.getNetwork();
    debug("network %o", net);
    this.logger.setChainId(net.chainId);
    this.startedFromBlock = await this.provider.getBlockNumber();

    const epCode = await this.provider.getCode(this.config.entryPoint);
    if (epCode === "0x") {
      throw new Error(`EntryPoint not deployed at ${this.config.entryPoint}`);
    }

    const bal = await this.wallet.getBalance();
    if (bal.eq(0)) {
      throw new Error("Bundler wallet has zero balance");
    }

    await this.logger.log({
      ts: Math.floor(Date.now() / 1000),
      level: "info",
      msg: "bundler started",
      meta: {
        entryPoint: this.config.entryPoint,
        network: this.config.network,
        bundler: await this.wallet.getAddress(),
        policy: this.config.policy ?? {},
        unsafe: Boolean(this.config.unsafe),
      },
    });

    this._startBundlingLoop();
  }

  async stop(): Promise<void> {
    if (this.bundlingTimer) clearInterval(this.bundlingTimer);
  }

  async getChainId(): Promise<number> {
    const { chainId } = await this.provider.getNetwork();
    return chainId;
  }

  async getSupportedEntryPoints(): Promise<string[]> {
    return [this.config.entryPoint];
  }

  async getAccounts(): Promise<string[]> {
    return [await this.wallet.getAddress()];
  }

  clientVersion(): string {
    return `aa-bundler/gasless-swap-demo (v0.7)${this.config.unsafe ? "/unsafe" : ""}`;
  }

  async estimateUserOperationGas(userOp: RpcUserOperationV07, entryPoint: string): Promise<any> {
    this._requireEntryPoint(entryPoint);

    // Default optional fields for estimation.
    //
    // Important: `factory` and `factoryData` must be provided together. Do NOT default `factoryData` unless
    // `factory` is present, otherwise schema validation will fail.
    const normalized: RpcUserOperationV07 = {
      ...userOp,
      paymasterData: userOp.paymasterData ?? "0x",
    };
    if (normalized.factory && !normalized.factoryData) {
      normalized.factoryData = "0x";
    }

    const packed = packUserOpV07(normalized);

    // Simulate validation using EntryPointSimulations (v0.7).
    const sim = await simulateValidationV07(this.provider, this.config.entryPoint, packed);
    const verificationGasLimit = BigNumber.from(sim.returnInfo.preOpGas);

    const preVerificationGas =
      BigNumber.from(normalized.preVerificationGas ?? "0x0").gt(0)
        ? BigNumber.from(normalized.preVerificationGas)
        : BigNumber.from(calcPreVerificationGasV07(packed));

    // callGasLimit: best-effort estimate. For counterfactual accounts, fall back to a safe default.
    let callGasLimit: BigNumber;
    try {
      const code = await this.provider.getCode(normalized.sender);
      if (code !== "0x") {
        callGasLimit = await this.provider.estimateGas({
          from: this.config.entryPoint,
          to: normalized.sender,
          data: normalized.callData,
        });
      } else {
        callGasLimit = BigNumber.from(normalized.callGasLimit ?? "0x0");
        if (callGasLimit.eq(0)) callGasLimit = BigNumber.from(1_500_000);
      }
    } catch {
      callGasLimit = BigNumber.from(1_500_000);
    }

    const account = parseValidationData(sim.returnInfo.accountValidationData);
    const paymaster = parseValidationData(sim.returnInfo.paymasterValidationData);

    return {
      preVerificationGas: preVerificationGas.toHexString(),
      verificationGasLimit: verificationGasLimit.toHexString(),
      callGasLimit: callGasLimit.toHexString(),
      validAfter: Math.max(account.validAfter, paymaster.validAfter) || undefined,
      validUntil: Math.min(account.validUntil, paymaster.validUntil) || undefined,
    };
  }

  async sendUserOperation(userOp: RpcUserOperationV07, entryPoint: string): Promise<string> {
    this._requireEntryPoint(entryPoint);

    const policy = this.config.policy ?? {};

    // demo-only failure injection
    if (typeof policy.failureRate === "number" && policy.failureRate > 0) {
      if (Math.random() < policy.failureRate) {
        await this.logger.log({
          ts: Math.floor(Date.now() / 1000),
          level: "warn",
          msg: "userOp rejected (injected failure)",
          sender: userOp.sender,
          meta: { policy },
        });
        throw new RpcError("bundler: injected failure", RpcErrorCodes.InternalError);
      }
    }

    const packed = packUserOpV07(userOp);
    const userOpHash: string = await this.entryPoint.callStatic.getUserOpHash(packed);

    try {
      // fee floors (wei)
      if (typeof policy.minPriorityFeeGwei === "number") {
        const minPrio = ethers.utils.parseUnits(policy.minPriorityFeeGwei.toString(), "gwei");
        if (BigNumber.from(userOp.maxPriorityFeePerGas).lt(minPrio)) {
          throw new RpcError("maxPriorityFeePerGas below bundler floor", RpcErrorCodes.InvalidParams);
        }
      }
      if (typeof policy.minMaxFeeGwei === "number") {
        const minMax = ethers.utils.parseUnits(policy.minMaxFeeGwei.toString(), "gwei");
        if (BigNumber.from(userOp.maxFeePerGas).lt(minMax)) {
          throw new RpcError("maxFeePerGas below bundler floor", RpcErrorCodes.InvalidParams);
        }
      }

      // Admission simulation (strict mode), using EntryPointSimulations (no debug_traceCall required).
      if (policy.strict) {
        const sim = await simulateValidationV07(this.provider, this.config.entryPoint, packed);
        const account = parseValidationData(sim.returnInfo.accountValidationData);
        const paymaster = parseValidationData(sim.returnInfo.paymasterValidationData);
        const validUntil = Math.min(account.validUntil, paymaster.validUntil);

        const minWindow = policy.minValidUntilSeconds ?? 0;
        if (minWindow > 0 && validUntil !== Number.MAX_SAFE_INTEGER) {
          const now = Math.floor(Date.now() / 1000);
          if (validUntil < now + minWindow) {
            throw new RpcError("userOp expires too soon for strict bundler", RpcErrorCodes.InvalidParams);
          }
        }
      }
    } catch (err: any) {
      await this.logger.log({
        ts: Math.floor(Date.now() / 1000),
        level: "warn",
        msg: "userOp rejected",
        userOpHash: userOpHash as any,
        sender: userOp.sender,
        meta: { error: err?.message ?? String(err), policy },
      });
      throw err;
    }

    const entry: MempoolEntry = {
      userOp,
      packed,
      userOpHash,
      receivedAtMs: Date.now(),
      status: "pending",
      eip7702Auth: userOp.eip7702Auth,
    };
    this.mempool.set(userOpHash, entry);

    await this.logger.log({
      ts: Math.floor(Date.now() / 1000),
      level: "info",
      msg: "userOp accepted",
      userOpHash: userOpHash as any,
      sender: userOp.sender,
      meta: { mempoolSize: this.mempool.size, policy },
    });

    // optional artificial delay
    if (typeof policy.delayMs === "number" && policy.delayMs > 0) {
      await new Promise((r) => setTimeout(r, policy.delayMs));
    }

    // attempt bundle immediately if configured
    if (this.config.autoBundleMempoolSize <= 1) {
      void this._attemptBundle(true);
    } else if (this.mempool.size >= this.config.autoBundleMempoolSize) {
      void this._attemptBundle(true);
    }

    return userOpHash;
  }

  async getUserOperationReceipt(userOpHash: string): Promise<UserOperationReceipt | null> {
    const existing = this.mempool.get(userOpHash);
    if (existing?.txReceipt) {
      return this._buildReceiptFromTx(userOpHash, existing.txReceipt);
    }

    const receipt = await this._findReceiptOnChain(userOpHash);
    return receipt;
  }

  async getUserOperationByHash(userOpHash: string): Promise<UserOperationByHashResponse | null> {
    const existing = this.mempool.get(userOpHash);
    if (existing?.txReceipt) {
      const tx = await this.provider.getTransaction(existing.txReceipt.transactionHash);
      return {
        userOperation: existing.userOp,
        entryPoint: this.config.entryPoint,
        transactionHash: existing.txReceipt.transactionHash,
        blockHash: existing.txReceipt.blockHash,
        blockNumber: BigNumber.from(existing.txReceipt.blockNumber).toHexString(),
      };
    }

    const eventLog = await this._findUserOperationEventLog(userOpHash);
    if (!eventLog) return null;

    const tx = await this.provider.getTransaction(eventLog.transactionHash);
    if (!tx || tx.to?.toLowerCase() !== this.config.entryPoint.toLowerCase()) return null;

    const parsed = this.entryPoint.interface.parseTransaction(tx);
    const ops: PackedUserOperationV07[] = parsed?.args?.ops;
    if (!ops) return null;

    const decodedEvent = this.entryPoint.interface.parseLog(eventLog);
    const sender = decodedEvent.args.sender as string;
    const nonce = decodedEvent.args.nonce as BigNumber;

    const op = ops.find((o) => o.sender.toLowerCase() === sender.toLowerCase() && BigNumber.from(o.nonce).eq(nonce));
    if (!op) return null;

    const unpacked = unpackUserOpV07(op);
    const block = await this.provider.getBlock(eventLog.blockNumber);

    return {
      userOperation: unpacked,
      entryPoint: this.config.entryPoint,
      transactionHash: eventLog.transactionHash,
      blockHash: block.hash,
      blockNumber: BigNumber.from(eventLog.blockNumber).toHexString(),
    };
  }

  // --- internal ---

  private _requireEntryPoint(entryPoint: string): void {
    if (!entryPoint) throw new RpcError("Missing entryPoint param", RpcErrorCodes.InvalidParams);
    if (entryPoint.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new RpcError(`Unsupported EntryPoint ${entryPoint}`, RpcErrorCodes.InvalidParams);
    }
  }

  private _startBundlingLoop(): void {
    if (this.config.autoBundleInterval <= 0) return;
    this.bundlingTimer = setInterval(() => void this._attemptBundle(false), this.config.autoBundleInterval * 1000);
  }

  private _selectPending(): MempoolEntry[] {
    const pending = Array.from(this.mempool.values())
      .filter((e) => e.status === "pending")
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs);

    const maxOps = this.config.autoBundleMempoolSize > 0 ? this.config.autoBundleMempoolSize : 1;
    return pending.slice(0, Math.max(1, Math.min(maxOps, 25)));
  }

  private async _attemptBundle(force: boolean): Promise<void> {
    if (this.bundlingInFlight) return;
    const pending = this._selectPending();
    if (!force && pending.length === 0) return;
    if (!force && pending.length < this.config.autoBundleMempoolSize) return;
    if (pending.length === 0) return;

    this.bundlingInFlight = true;
    try {
      const beneficiary = await this._selectBeneficiary();
      const ops = pending.map((e) => e.packed);
      const authList = pending.map((e) => e.eip7702Auth).filter(Boolean);

      await this.logger.log({
        ts: Math.floor(Date.now() / 1000),
        level: "info",
        msg: "bundle attempt",
        meta: {
          beneficiary,
          ops: pending.length,
          userOpHashes: pending.map((e) => e.userOpHash),
          use7702: authList.length > 0,
        },
      });

      let tx: ethers.providers.TransactionResponse;
      if (authList.length > 0) {
        // Send as EIP-7702 Type 4 transaction
        const data = this.entryPoint.interface.encodeFunctionData("handleOps", [ops, beneficiary]);
        const nonce = await this.wallet.getTransactionCount();
        const feeData = await this.provider.getFeeData();
        const { chainId } = await this.provider.getNetwork();

        const txPayload = {
          chainId,
          nonce,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? ethers.utils.parseUnits("1", "gwei"),
          maxFeePerGas: feeData.maxFeePerGas ?? ethers.utils.parseUnits("2", "gwei"),
          gasLimit: BigNumber.from(this.config.maxBundleGas),
          to: this.entryPoint.address,
          value: BigNumber.from(0),
          data,
          accessList: [],
          authorizationList: authList,
        };

        const signedRawTx = await signEIP7702Transaction(this.wallet, txPayload);
        tx = await this.provider.sendTransaction(signedRawTx);
      } else {
        tx = await this.entryPoint.handleOps(ops, beneficiary, { gasLimit: this.config.maxBundleGas });
      }
      pending.forEach((e) => {
        e.status = "sent";
        e.txHash = tx.hash;
      });

      await this.logger.log({
        ts: Math.floor(Date.now() / 1000),
        level: "info",
        msg: "bundle submitted",
        txHash: tx.hash as any,
        meta: { ops: pending.length, userOpHashes: pending.map((e) => e.userOpHash) },
      });

      const receipt = await tx.wait();

      for (const e of pending) {
        e.status = "mined";
        e.txReceipt = receipt;
        try {
          const opReceipt = this._buildReceiptFromTx(e.userOpHash, receipt);
          await this.logger.log({
            ts: Math.floor(Date.now() / 1000),
            level: opReceipt.success ? "info" : "warn",
            msg: "userOp mined",
            userOpHash: e.userOpHash as any,
            sender: opReceipt.sender as any,
            txHash: receipt.transactionHash as any,
            meta: {
              success: opReceipt.success,
              actualGasCostWei: opReceipt.actualGasCost,
              actualGasUsed: opReceipt.actualGasUsed,
            },
          });
        } catch (err: any) {
          await this.logger.log({
            ts: Math.floor(Date.now() / 1000),
            level: "warn",
            msg: "userOp mined (receipt decode failed)",
            userOpHash: e.userOpHash as any,
            sender: e.userOp.sender,
            txHash: receipt.transactionHash as any,
            meta: { error: err?.message ?? String(err) },
          });
        }
      }
    } catch (err) {
      pending.forEach((e) => (e.status = "failed"));
      const formatted = await this._formatEntryPointError(err);
      debug("bundle failed: %s", formatted);

      await this.logger.log({
        ts: Math.floor(Date.now() / 1000),
        level: "error",
        msg: "bundle failed",
        meta: {
          error: formatted,
          ops: pending.length,
          userOpHashes: pending.map((e) => e.userOpHash),
        },
      });

      for (const e of pending) {
        await this.logger.log({
          ts: Math.floor(Date.now() / 1000),
          level: "warn",
          msg: "userOp failed (bundle failed)",
          userOpHash: e.userOpHash as any,
          sender: e.userOp.sender,
          txHash: (e.txHash as any) ?? undefined,
          meta: { error: formatted },
        });
      }
    } finally {
      this.bundlingInFlight = false;
    }
  }

  private async _formatEntryPointError(err: any): Promise<string> {
    const data =
      (typeof err?.data === "string" && err.data.startsWith("0x") && err.data) ||
      (typeof err?.error?.data === "string" && err.error.data.startsWith("0x") && err.error.data) ||
      (typeof err?.error?.data?.data === "string" && err.error.data.data.startsWith("0x") && err.error.data.data) ||
      undefined;

    const finalData = data ?? (await this._tryRecoverRevertDataViaCall(err));

    if (finalData) {
      // Try EntryPoint custom errors first.
      try {
        const parsed = this.entryPoint.interface.parseError(finalData);
        if (parsed?.name === "FailedOp") {
          const opIndex = BigNumber.from(parsed.args.opIndex).toNumber();
          const reason = String(parsed.args.reason ?? "");
          return `EntryPoint.FailedOp(opIndex=${opIndex}, reason=${reason})`;
        }
        if (parsed?.name === "FailedOpWithRevert") {
          const opIndex = BigNumber.from(parsed.args.opIndex).toNumber();
          const reason = String(parsed.args.reason ?? "");
          const inner = String(parsed.args.inner ?? "");
          const innerDecoded = this._decodeRevertData(inner);
          return `EntryPoint.FailedOpWithRevert(opIndex=${opIndex}, reason=${reason}, inner=${innerDecoded})`;
        }
        return `EntryPoint.${parsed.name}(${parsed.args.map((a: any) => String(a)).join(",")})`;
      } catch {
        // ignore
      }

      const standardDecoded = this._decodeRevertData(finalData);
      return standardDecoded;
    }

    const msg = typeof err?.message === "string" ? err.message : String(err);
    return msg;
  }

  private async _tryRecoverRevertDataViaCall(err: any): Promise<string | undefined> {
    const tx = err?.transaction;
    if (!tx || typeof tx?.to !== "string" || typeof tx?.data !== "string") return undefined;

    const from = typeof tx?.from === "string" ? tx.from : await this.wallet.getAddress();
    const blockTag = typeof err?.receipt?.blockNumber === "number" ? err.receipt.blockNumber : "latest";

    try {
      const callPromise = this.provider.call(
        {
          from,
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0,
          gasLimit: tx.gasLimit ?? this.config.maxBundleGas,
        },
        blockTag,
      );

      // Avoid hanging bundling on error formatting.
      const timeoutMs = 3_000;
      await Promise.race([
        callPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
      return undefined;
    } catch (callErr: any) {
      const callData =
        (typeof callErr?.data === "string" && callErr.data.startsWith("0x") && callErr.data) ||
        (typeof callErr?.error?.data === "string" && callErr.error.data.startsWith("0x") && callErr.error.data) ||
        (typeof callErr?.error?.data?.data === "string" &&
          callErr.error.data.data.startsWith("0x") &&
          callErr.error.data.data) ||
        undefined;
      return callData;
    }
  }

  private _decodeRevertData(data: string): string {
    if (typeof data !== "string" || !data.startsWith("0x")) return String(data);

    // Error(string)
    if (data.slice(0, 10) === "0x08c379a0") {
      try {
        const [reason] = ethers.utils.defaultAbiCoder.decode(["string"], "0x" + data.slice(10));
        return `Error(${reason})`;
      } catch {
        return "Error(<decode failed>)";
      }
    }

    // Panic(uint256)
    if (data.slice(0, 10) === "0x4e487b71") {
      try {
        const [code] = ethers.utils.defaultAbiCoder.decode(["uint256"], "0x" + data.slice(10));
        return `Panic(${BigNumber.from(code).toString()})`;
      } catch {
        return "Panic(<decode failed>)";
      }
    }

    return data;
  }

  private async _selectBeneficiary(): Promise<string> {
    const configuredBeneficiary = this.config.beneficiary;
    if (
      !configuredBeneficiary ||
      configuredBeneficiary.toLowerCase() === ethers.constants.AddressZero.toLowerCase()
    ) {
      return await this.wallet.getAddress();
    }

    const currentBalance = await this.provider.getBalance(await this.wallet.getAddress());
    const minBalance = BigNumber.from(this.config.minBalance ?? "0");
    if (currentBalance.lte(minBalance)) {
      return await this.wallet.getAddress();
    }
    return configuredBeneficiary;
  }

  private async _findUserOperationEventLog(userOpHash: string): Promise<ethers.providers.Log | null> {
    const topic0 = this.entryPoint.interface.getEventTopic("UserOperationEvent");
    const logs = await this.provider.getLogs({
      address: this.config.entryPoint,
      topics: [topic0, userOpHash],
      fromBlock: this.startedFromBlock,
      toBlock: "latest",
    });
    return logs[0] ?? null;
  }

  private async _findReceiptOnChain(userOpHash: string): Promise<UserOperationReceipt | null> {
    const log = await this._findUserOperationEventLog(userOpHash);
    if (!log) return null;
    const txReceipt = await this.provider.getTransactionReceipt(log.transactionHash);
    return this._buildReceiptFromTx(userOpHash, txReceipt);
  }

  private _filterLogsForUserOp(userOpHash: string, logs: ethers.providers.Log[]): ethers.providers.Log[] {
    const userOpEventTopic = this.entryPoint.interface.getEventTopic("UserOperationEvent");
    const beforeExecutionTopic = this.entryPoint.interface.getEventTopic("BeforeExecution");

    let startIndex = -1;
    let endIndex = -1;

    logs.forEach((log, index) => {
      if (log.topics[0] === beforeExecutionTopic) {
        startIndex = endIndex = index;
      } else if (log.topics[0] === userOpEventTopic) {
        if (log.topics[1]?.toLowerCase() === userOpHash.toLowerCase()) {
          endIndex = index;
        } else if (endIndex === -1) {
          startIndex = index;
        }
      }
    });

    if (endIndex === -1) return logs;
    return logs.slice(startIndex + 1, endIndex);
  }

  private _buildReceiptFromTx(userOpHash: string, txReceipt: ethers.providers.TransactionReceipt): UserOperationReceipt {
    const userOpEventTopic = this.entryPoint.interface.getEventTopic("UserOperationEvent");
    const eventLog = txReceipt.logs.find(
      (l) => l.address.toLowerCase() === this.config.entryPoint.toLowerCase() && l.topics[0] === userOpEventTopic && l.topics[1]?.toLowerCase() === userOpHash.toLowerCase(),
    );
    if (!eventLog) {
      throw new RpcError("UserOperationEvent not found in tx receipt", RpcErrorCodes.InternalError);
    }

    const parsed = this.entryPoint.interface.parseLog(eventLog);
    const filteredLogs = this._filterLogsForUserOp(userOpHash, txReceipt.logs);

    return {
      userOpHash,
      sender: parsed.args.sender,
      nonce: BigNumber.from(parsed.args.nonce).toHexString(),
      actualGasCost: BigNumber.from(parsed.args.actualGasCost).toHexString(),
      actualGasUsed: BigNumber.from(parsed.args.actualGasUsed).toHexString(),
      success: Boolean(parsed.args.success),
      logs: filteredLogs,
      receipt: txReceipt,
    };
  }
}
