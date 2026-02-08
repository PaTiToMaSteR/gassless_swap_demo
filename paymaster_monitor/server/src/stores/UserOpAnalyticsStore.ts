import type { EntryPointUserOperationEvent, PaymasterPostOpHandledEvent, SenderMetrics, UserOpSummary, UserOpsMetricsSummary } from "../types";

export class UserOpAnalyticsStore {
  private readonly max: number;
  private readonly byHash = new Map<string, UserOpSummary>();

  constructor({ max }: { max: number }) {
    this.max = Math.max(1, max);
  }

  ingestEntryPointEvents(events: EntryPointUserOperationEvent[]): void {
    for (const e of events) {
      const key = e.userOpHash.toLowerCase();
      const existing = this.byHash.get(key);

      // Idempotency: if we already stored the same tx/log, ignore.
      if (existing && existing.txHash.toLowerCase() === e.txHash.toLowerCase() && existing.blockNumber === e.blockNumber) {
        continue;
      }

      const next: UserOpSummary = {
        ts: e.ts,
        chainId: e.chainId,
        blockNumber: e.blockNumber,
        txHash: e.txHash,
        userOpHash: e.userOpHash,
        sender: e.sender,
        paymaster: e.paymaster,
        bundler: e.bundler,
        nonce: e.nonce,
        success: e.success,
        actualGasCostWei: e.actualGasCostWei,
        actualGasUsed: e.actualGasUsed,
        feeAmount: existing?.feeAmount,
        postOpMode: existing?.postOpMode,
        revertReason: e.revertReason ?? existing?.revertReason,
      };

      this.byHash.set(key, next);
    }

    this._evictIfNeeded();
  }

  ingestPaymasterEvents(events: PaymasterPostOpHandledEvent[]): void {
    for (const e of events) {
      const key = e.userOpHash.toLowerCase();
      const existing = this.byHash.get(key);
      if (!existing) {
        // Keep partial record so the UI can show "indexed but missing entrypoint event".
        this.byHash.set(key, {
          ts: e.ts,
          chainId: e.chainId,
          blockNumber: e.blockNumber,
          txHash: e.txHash,
          userOpHash: e.userOpHash,
          sender: e.sender,
          paymaster: ("0x0000000000000000000000000000000000000000" as any),
          nonce: "0",
          success: e.mode === "opSucceeded",
          actualGasCostWei: e.actualGasCostWei,
          actualGasUsed: "0",
          feeAmount: e.feeAmount,
          postOpMode: e.mode,
        });
        continue;
      }

      this.byHash.set(key, {
        ...existing,
        feeAmount: e.feeAmount,
        postOpMode: e.mode,
      });
    }

    this._evictIfNeeded();
  }

  listUserOps(params?: { limit?: number; sender?: string; success?: "true" | "false" }): UserOpSummary[] {
    const limit = Math.max(1, Math.min(Number(params?.limit ?? 200), 2000));
    const sender = params?.sender?.toLowerCase();
    const successFilter =
      params?.success === "true" ? true : params?.success === "false" ? false : undefined;

    const list = Array.from(this.byHash.values())
      .filter((u) => !sender || u.sender.toLowerCase() === sender)
      .filter((u) => successFilter === undefined || u.success === successFilter)
      .sort((a, b) => b.ts - a.ts || b.blockNumber - a.blockNumber);

    return list.slice(0, limit);
  }

  metricsSummary(): UserOpsMetricsSummary {
    const uniqueSenders = new Set<string>();
    let succeeded = 0;
    let failed = 0;
    let totalGas = BigInt(0);
    let totalFee = BigInt(0);

    for (const u of this.byHash.values()) {
      uniqueSenders.add(u.sender.toLowerCase());
      if (u.success) succeeded++;
      else failed++;
      try {
        totalGas += BigInt(u.actualGasCostWei);
      } catch {
        // ignore
      }
      if (u.feeAmount) {
        try {
          totalFee += BigInt(u.feeAmount);
        } catch {
          // ignore
        }
      }
    }

    return {
      total: this.byHash.size,
      succeeded,
      failed,
      uniqueSenders: uniqueSenders.size,
      totalActualGasCostWei: totalGas.toString(),
      totalFeeAmount: totalFee.toString(),
    };
  }

  getFailureMetrics(): Array<{ reason: string; count: number }> {
    const reasons = new Map<string, number>();
    for (const u of this.byHash.values()) {
      if (!u.success) {
        const r = u.revertReason || "Unknown / Reverted";
        reasons.set(r, (reasons.get(r) ?? 0) + 1);
      }
    }
    return Array.from(reasons.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }

  perSenderMetrics(): SenderMetrics[] {
    const bySender = new Map<
      string,
      { sender: string; total: number; succeeded: number; failed: number; lastOpTs: number; gasWei: bigint; feeWei: bigint }
    >();

    for (const u of this.byHash.values()) {
      const key = u.sender.toLowerCase();
      const cur =
        bySender.get(key) ?? { sender: u.sender, total: 0, succeeded: 0, failed: 0, lastOpTs: 0, gasWei: BigInt(0), feeWei: BigInt(0) };

      cur.total += 1;
      if (u.success) cur.succeeded += 1;
      else cur.failed += 1;
      cur.lastOpTs = Math.max(cur.lastOpTs, u.ts);

      try {
        cur.gasWei += BigInt(u.actualGasCostWei);
      } catch {
        // ignore
      }
      if (u.feeAmount) {
        try {
          cur.feeWei += BigInt(u.feeAmount);
        } catch {
          // ignore
        }
      }

      bySender.set(key, cur);
    }

    return Array.from(bySender.values())
      .sort((a, b) => b.lastOpTs - a.lastOpTs)
      .map((s) => ({
        sender: s.sender as any,
        total: s.total,
        succeeded: s.succeeded,
        failed: s.failed,
        lastOpTs: s.lastOpTs || undefined,
        totalActualGasCostWei: s.gasWei.toString(),
        totalFeeAmount: s.feeWei.toString(),
      }));
  }

  timeseries(params?: { windowSec?: number; bucketSec?: number }): Array<{ t: number; ops: number; feesWei: string; gasWei: string }> {
    const now = Math.floor(Date.now() / 1000);
    const windowSec = Math.max(60, Math.min(Number(params?.windowSec ?? 24 * 3600), 30 * 24 * 3600));
    const bucketSec = Math.max(60, Math.min(Number(params?.bucketSec ?? 3600), windowSec));

    const start = now - windowSec;
    const buckets = new Map<number, { ops: number; feesWei: bigint; gasWei: bigint }>();

    const bucketStart = (ts: number) => start + Math.floor((ts - start) / bucketSec) * bucketSec;

    for (const u of this.byHash.values()) {
      if (u.ts < start) continue;
      const b = bucketStart(u.ts);
      const cur = buckets.get(b) ?? { ops: 0, feesWei: BigInt(0), gasWei: BigInt(0) };
      cur.ops += 1;
      try {
        cur.gasWei += BigInt(u.actualGasCostWei);
      } catch {
        // ignore
      }
      if (u.feeAmount) {
        try {
          cur.feesWei += BigInt(u.feeAmount);
        } catch {
          // ignore
        }
      }
      buckets.set(b, cur);
    }

    const out: Array<{ t: number; ops: number; feesWei: string; gasWei: string }> = [];
    for (let t = start; t <= now; t += bucketSec) {
      const b = buckets.get(t) ?? { ops: 0, feesWei: BigInt(0), gasWei: BigInt(0) };
      out.push({ t, ops: b.ops, feesWei: b.feesWei.toString(), gasWei: b.gasWei.toString() });
    }
    return out;
  }

  private _evictIfNeeded(): void {
    if (this.byHash.size <= this.max) return;
    const removeCount = this.byHash.size - this.max;
    const oldest = Array.from(this.byHash.values())
      .sort((a, b) => a.ts - b.ts || a.blockNumber - b.blockNumber)
      .slice(0, removeCount);
    for (const u of oldest) this.byHash.delete(u.userOpHash.toLowerCase());
  }
}
