import Debug from "debug";

import type { QuoteResponse } from "./types";

const debug = Debug("gasless-swap:quote_service");

type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  ts: number;
  level: LogLevel;
  service: string;
  msg: string;
  requestId?: string;
  quoteId?: string;
  sender?: string;
  meta?: Record<string, unknown>;
};

export class Logger {
  static recentLogs: LogEvent[] = [];

  constructor(readonly opts: { logIngestUrl?: string }) { }

  async log(event: LogEvent): Promise<void> {
    debug("%s", event.msg);
    // Always print JSON to stdout for the admin log explorer to capture.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(event));

    Logger.recentLogs.push(event);
    if (Logger.recentLogs.length > 50) Logger.recentLogs.shift();

    if (!this.opts.logIngestUrl) return;
    try {
      await fetch(this.opts.logIngestUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
    } catch {
      // swallow (demo)
    }
  }

  quoteCreated(args: { requestId?: string; quote: QuoteResponse }): Promise<void> {
    return this.log({
      ts: Math.floor(Date.now() / 1000),
      level: "info",
      service: "quote_service",
      msg: "quote created",
      requestId: args.requestId,
      quoteId: args.quote.quoteId,
      sender: args.quote.sender,
      meta: {
        tokenIn: args.quote.tokenIn,
        tokenOut: args.quote.tokenOut,
        amountIn: args.quote.amountIn,
        amountOut: args.quote.amountOut,
        minOut: args.quote.minOut,
        deadline: args.quote.deadline,
      },
    });
  }
}
