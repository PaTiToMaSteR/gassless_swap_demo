import fs from "node:fs";
import path from "node:path";

function isoDayFromTsSec(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString().slice(0, 10);
}

export class NdjsonDailyWriter<T extends { ts: number }> {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly cfg: {
      dir: string;
      coerce: (raw: unknown) => T | null;
      maxTailBytes?: number;
    },
  ) {}

  init(): void {
    fs.mkdirSync(this.cfg.dir, { recursive: true });
  }

  listFiles(): string[] {
    try {
      const entries = fs.readdirSync(this.cfg.dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(e.name))
        .map((e) => path.join(this.cfg.dir, e.name))
        .sort();
    } catch {
      return [];
    }
  }

  append(records: T[]): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    this.init();

    const byFile = new Map<string, string[]>();
    for (const r of records) {
      const filePath = path.join(this.cfg.dir, `${isoDayFromTsSec(r.ts)}.ndjson`);
      const lines = byFile.get(filePath) ?? [];
      lines.push(JSON.stringify(r));
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
        console.error("[monitor] failed to persist NDJSON records", err);
      });

    return this.queue;
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  loadRecent(maxRecords: number): T[] {
    if (maxRecords <= 0) return [];
    this.init();

    const files = this.listFiles();
    const batches: T[][] = [];
    let remaining = maxRecords;

    for (let i = files.length - 1; i >= 0 && remaining > 0; i--) {
      const filePath = files[i];
      const events = this._readFileTailRecords(filePath, remaining);
      remaining -= events.length;
      batches.unshift(events);
    }

    return batches.flat();
  }

  private _readFileTailRecords(filePath: string, maxRecords: number): T[] {
    const maxBytes = this.cfg.maxTailBytes ?? 512 * 1024;
    const { text, startOffset } = this._readTailUtf8(filePath, maxBytes);

    const rawLines = text.split(/\r?\n/);
    if (startOffset > 0 && rawLines.length > 0) rawLines.shift(); // likely partial line

    const lines = rawLines.map((l) => l.trim()).filter(Boolean);
    const picked = lines.slice(-maxRecords);

    const out: T[] = [];
    for (const line of picked) {
      try {
        const parsed = JSON.parse(line);
        const rec = this.cfg.coerce(parsed);
        if (rec) out.push(rec);
      } catch {
        // ignore invalid lines
      }
    }
    return out;
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

