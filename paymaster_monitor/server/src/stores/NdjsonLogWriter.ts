import fs from "node:fs";
import path from "node:path";

import type { LogEvent } from "../types";

function isoDayFromTsSec(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceLogEvent(raw: unknown): LogEvent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.ts !== "number" || typeof raw.level !== "string" || typeof raw.service !== "string" || typeof raw.msg !== "string") return null;
  const level = raw.level as LogEvent["level"];
  if (!["debug", "info", "warn", "error"].includes(level)) return null;

  return {
    ts: raw.ts,
    level,
    service: raw.service,
    msg: raw.msg,
    requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    quoteId: typeof raw.quoteId === "string" ? raw.quoteId : undefined,
    userOpHash: typeof raw.userOpHash === "string" ? (raw.userOpHash as any) : undefined,
    sender: typeof raw.sender === "string" ? (raw.sender as any) : undefined,
    owner: typeof raw.owner === "string" ? (raw.owner as any) : undefined,
    txHash: typeof raw.txHash === "string" ? (raw.txHash as any) : undefined,
    chainId: typeof raw.chainId === "number" ? raw.chainId : undefined,
    meta: isRecord(raw.meta) ? raw.meta : undefined,
  };
}

export class NdjsonLogWriter {
  private readonly logsDir: string;
  private queue: Promise<void> = Promise.resolve();

  constructor({ dataDir }: { dataDir: string }) {
    this.logsDir = path.join(dataDir, "logs");
  }

  init(): void {
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  listFiles(): string[] {
    try {
      const entries = fs.readdirSync(this.logsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(e.name))
        .map((e) => path.join(this.logsDir, e.name))
        .sort();
    } catch {
      return [];
    }
  }

  append(events: LogEvent[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    this.init();

    const byFile = new Map<string, string[]>();
    for (const e of events) {
      const filePath = path.join(this.logsDir, `${isoDayFromTsSec(e.ts)}.ndjson`);
      const lines = byFile.get(filePath) ?? [];
      lines.push(JSON.stringify(e));
      byFile.set(filePath, lines);
    }

    const tasks = [...byFile.entries()].map(([filePath, lines]) => ({ filePath, text: `${lines.join("\n")}\n` }));

    this.queue = this.queue
      .then(async () => {
        for (const t of tasks) {
          await fs.promises.appendFile(t.filePath, t.text, "utf8");
        }
      })
      .catch((err) => {
        // Keep the queue alive; persistence failures should not crash the demo.
        // eslint-disable-next-line no-console
        console.error("[monitor] failed to persist logs", err);
      });

    return this.queue;
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  loadRecent(maxEvents: number): LogEvent[] {
    if (maxEvents <= 0) return [];
    this.init();

    const files = this.listFiles();
    const batches: LogEvent[][] = [];

    let remaining = maxEvents;
    for (let i = files.length - 1; i >= 0 && remaining > 0; i--) {
      const filePath = files[i];
      const events = this._readFileTailEvents(filePath, remaining);
      remaining -= events.length;
      batches.unshift(events);
    }

    return batches.flat();
  }

  private _readFileTailEvents(filePath: string, maxEvents: number): LogEvent[] {
    const maxBytes = 512 * 1024; // enough for thousands of log lines in typical demo volumes
    const { text, startOffset } = this._readTailUtf8(filePath, maxBytes);

    const rawLines = text.split(/\r?\n/);
    // If we didn't read from start-of-file, the first line is likely partial.
    if (startOffset > 0 && rawLines.length > 0) rawLines.shift();

    const lines = rawLines.map((l) => l.trim()).filter(Boolean);
    const picked = lines.slice(-maxEvents);

    const events: LogEvent[] = [];
    for (const line of picked) {
      try {
        const parsed = JSON.parse(line);
        const e = coerceLogEvent(parsed);
        if (e) events.push(e);
      } catch {
        // ignore invalid lines
      }
    }
    return events;
  }

  private _readTailUtf8(filePath: string, maxBytes: number): { text: string; startOffset: number } {
    const stat = fs.statSync(filePath);
    const startOffset = Math.max(0, stat.size - maxBytes);
    const len = stat.size - startOffset;
    if (len <= 0) return { text: "", startOffset };

    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, startOffset);
      return { text: buf.toString("utf8"), startOffset };
    } finally {
      fs.closeSync(fd);
    }
  }
}

