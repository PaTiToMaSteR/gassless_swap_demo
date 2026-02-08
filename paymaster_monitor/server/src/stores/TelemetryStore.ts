export type SessionHeartbeat = {
  sessionId: string;
  app: "web" | "admin";
  owner?: string;
  sender?: string;
  lastSeenMs: number;
};

export type TelemetryEventName =
  | "paid_fallback_attempt"
  | "paid_fallback_success"
  | "paid_fallback_failure";

type Seen = { firstSeenMs: number; lastSeenMs: number };

export class TelemetryStore {
  private sessions = new Map<string, SessionHeartbeat>();
  private owners = new Map<string, Seen & { owner: string }>();
  private senders = new Map<string, Seen & { sender: string; owner?: string }>();
  private ownerToSenders = new Map<string, Set<string>>();
  private eventCounts = new Map<TelemetryEventName, number>();

  upsertSession(hb: Omit<SessionHeartbeat, "lastSeenMs">): void {
    const now = Date.now();
    this.sessions.set(hb.sessionId, { ...hb, lastSeenMs: now });

    if (hb.owner) {
      const key = hb.owner.toLowerCase();
      const existing = this.owners.get(key);
      if (existing) existing.lastSeenMs = now;
      else this.owners.set(key, { owner: hb.owner, firstSeenMs: now, lastSeenMs: now });
    }

    if (hb.sender) {
      const key = hb.sender.toLowerCase();
      const existing = this.senders.get(key);
      if (existing) {
        existing.lastSeenMs = now;
        if (hb.owner) existing.owner = hb.owner;
      } else {
        this.senders.set(key, { sender: hb.sender, owner: hb.owner, firstSeenMs: now, lastSeenMs: now });
      }
    }

    if (hb.owner && hb.sender) {
      const ownerKey = hb.owner.toLowerCase();
      const senderKey = hb.sender.toLowerCase();
      const set = this.ownerToSenders.get(ownerKey) ?? new Set<string>();
      set.add(senderKey);
      this.ownerToSenders.set(ownerKey, set);
    }
  }

  recordEvent(name: TelemetryEventName): void {
    this.eventCounts.set(name, (this.eventCounts.get(name) ?? 0) + 1);
  }

  getEventCount(name: TelemetryEventName): number {
    return this.eventCounts.get(name) ?? 0;
  }

  getPaidFallbackMetrics(): { attempted: number; succeeded: number; failed: number } {
    return {
      attempted: this.getEventCount("paid_fallback_attempt"),
      succeeded: this.getEventCount("paid_fallback_success"),
      failed: this.getEventCount("paid_fallback_failure"),
    };
  }

  getActiveCounts({ windowMs }: { windowMs: number }): { web: number; admin: number; total: number } {
    const cutoff = Date.now() - windowMs;
    let web = 0;
    let admin = 0;
    for (const s of this.sessions.values()) {
      if (s.lastSeenMs < cutoff) continue;
      if (s.app === "web") web++;
      if (s.app === "admin") admin++;
    }
    return { web, admin, total: web + admin };
  }

  getUniqueOwnersCount(): number {
    return this.owners.size;
  }

  getUniqueSendersCount(): number {
    return this.senders.size;
  }

  listOwners(): Array<{ owner: string; firstSeenMs: number; lastSeenMs: number; senders: string[] }> {
    const out: Array<{ owner: string; firstSeenMs: number; lastSeenMs: number; senders: string[] }> = [];
    for (const [ownerKey, seen] of this.owners.entries()) {
      const senders = Array.from(this.ownerToSenders.get(ownerKey) ?? []).map((s) => this.senders.get(s)?.sender ?? s);
      out.push({ owner: seen.owner, firstSeenMs: seen.firstSeenMs, lastSeenMs: seen.lastSeenMs, senders });
    }
    return out.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
  }

  listSenders(): Array<{ sender: string; firstSeenMs: number; lastSeenMs: number; owner?: string }> {
    const out: Array<{ sender: string; firstSeenMs: number; lastSeenMs: number; owner?: string }> = [];
    for (const seen of this.senders.values()) {
      out.push({ sender: seen.sender, owner: seen.owner, firstSeenMs: seen.firstSeenMs, lastSeenMs: seen.lastSeenMs });
    }
    return out.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
  }
}
