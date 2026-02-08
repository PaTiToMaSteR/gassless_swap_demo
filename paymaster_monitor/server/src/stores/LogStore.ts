import type { LogEvent } from "../types";

export class LogStore {
  private readonly max: number;
  private readonly logs: LogEvent[] = [];
  private readonly subscribers = new Set<(log: LogEvent) => void>();

  constructor({ max }: { max: number }) {
    this.max = max;
  }

  subscribe(fn: (log: LogEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  ingest(events: LogEvent[], opts?: { notify?: boolean }): void {
    const notify = opts?.notify !== false;
    for (const event of events) this._push(event, notify);
  }

  query(params: {
    service?: string;
    level?: string;
    q?: string;
    requestId?: string;
    quoteId?: string;
    userOpHash?: string;
    sender?: string;
    txHash?: string;
    since?: number;
    until?: number;
    limit?: number;
  }): LogEvent[] {
    const limit = Math.max(1, Math.min(params.limit ?? 200, 2000));

    const normalizedService = params.service?.toLowerCase();
    const normalizedLevel = params.level?.toLowerCase();
    const q = params.q?.toLowerCase();
    const requestId = params.requestId?.toLowerCase();
    const quoteId = params.quoteId?.toLowerCase();
    const userOpHash = params.userOpHash?.toLowerCase();
    const sender = params.sender?.toLowerCase();
    const txHash = params.txHash?.toLowerCase();

    const since = params.since;
    const until = params.until;

    const out: LogEvent[] = [];
    for (let i = this.logs.length - 1; i >= 0; i--) {
      const e = this.logs[i];
      if (normalizedService && e.service.toLowerCase() !== normalizedService) continue;
      if (normalizedLevel && e.level.toLowerCase() !== normalizedLevel) continue;
      if (since != null && e.ts < since) continue;
      if (until != null && e.ts > until) continue;
      if (requestId && (e.requestId ?? "").toLowerCase() !== requestId) continue;
      if (quoteId && (e.quoteId ?? "").toLowerCase() !== quoteId) continue;
      if (userOpHash && (e.userOpHash ?? "").toLowerCase() !== userOpHash) continue;
      if (sender && (e.sender ?? "").toLowerCase() !== sender) continue;
      if (txHash && (e.txHash ?? "").toLowerCase() !== txHash) continue;
      if (q && !this._matchesQuery(e, q)) continue;

      out.push(e);
      if (out.length >= limit) break;
    }
    return out.reverse();
  }

  count(): number {
    return this.logs.length;
  }

  private _matchesQuery(e: LogEvent, q: string): boolean {
    if (e.msg.toLowerCase().includes(q)) return true;
    if (JSON.stringify(e.meta ?? {}).toLowerCase().includes(q)) return true;
    return false;
  }

  private _push(event: LogEvent, notify: boolean): void {
    this.logs.push(event);
    while (this.logs.length > this.max) this.logs.shift();
    if (notify) for (const sub of this.subscribers) sub(event);
  }
}
