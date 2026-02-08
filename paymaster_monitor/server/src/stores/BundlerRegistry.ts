import type { ChildProcess } from "node:child_process";

import type { BundlerInstancePublic, BundlerPolicy, BundlerStatus } from "../types";

export type BundlerInstanceInternal = BundlerInstancePublic & {
  port?: number;
  spawnedAt: number;
  pid?: number;
  process?: ChildProcess;
  configPath?: string;
  base?: string;
};

export class BundlerRegistry {
  private instances = new Map<string, BundlerInstanceInternal>();

  list(): BundlerInstanceInternal[] {
    return Array.from(this.instances.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  listPublic(): BundlerInstancePublic[] {
    return this.list().map(({ id, name, rpcUrl, status, policy, lastSeen, spawned }) => ({
      id,
      name,
      rpcUrl,
      status,
      policy,
      lastSeen,
      spawned,
    }));
  }

  get(id: string): BundlerInstanceInternal | undefined {
    return this.instances.get(id);
  }

  upsert(instance: BundlerInstanceInternal): void {
    this.instances.set(instance.id, instance);
  }

  remove(id: string): void {
    this.instances.delete(id);
  }

  updateStatus(id: string, status: BundlerStatus, lastSeen?: number): void {
    const existing = this.instances.get(id);
    if (!existing) return;
    existing.status = status;
    if (lastSeen) existing.lastSeen = lastSeen;
  }

  updatePolicy(id: string, policy: BundlerPolicy): void {
    const existing = this.instances.get(id);
    if (!existing) return;
    existing.policy = policy;
  }
}

