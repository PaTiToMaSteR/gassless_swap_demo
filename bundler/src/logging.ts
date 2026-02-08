import Debug from "debug";

const debug = Debug("gasless-swap:bundler:logs");

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  ts: number;
  level: LogLevel;
  service: string;
  msg: string;

  requestId?: string;
  sessionId?: string;
  quoteId?: string;
  userOpHash?: `0x${string}`;
  sender?: `0x${string}`;
  owner?: `0x${string}`;
  txHash?: `0x${string}`;
  chainId?: number;

  meta?: Record<string, unknown>;
};

function joinUrl(base: string, suffix: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const s = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${b}${s}`;
}

export class Logger {
  private readonly service: string;
  private readonly logIngestUrl?: string;
  private chainId?: number;

  constructor(opts: { service: string; monitorUrl?: string; chainId?: number }) {
    this.service = opts.service;
    this.chainId = opts.chainId;
    this.logIngestUrl = opts.monitorUrl ? joinUrl(opts.monitorUrl, "/api/logs/ingest") : undefined;
  }

  setChainId(chainId: number): void {
    this.chainId = chainId;
  }

  async log(event: Omit<LogEvent, "service" | "chainId"> & { service?: string; chainId?: number }): Promise<void> {
    const full: LogEvent = {
      ts: event.ts,
      level: event.level,
      service: event.service ?? this.service,
      msg: event.msg,
      requestId: event.requestId,
      sessionId: event.sessionId,
      quoteId: event.quoteId,
      userOpHash: event.userOpHash,
      sender: event.sender,
      owner: event.owner,
      txHash: event.txHash,
      chainId: event.chainId ?? this.chainId,
      meta: event.meta ?? {},
    };

    debug("%s", full.msg);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(full));

    if (!this.logIngestUrl) return;
    try {
      await fetch(this.logIngestUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(full),
      });
    } catch {
      // swallow (demo)
    }
  }
}

