import type { HexString, WalletStats, TransactionSummary } from "../types";

export class WalletAnalyticsStore {
    private readonly max: number;
    private readonly wallets = new Map<string, WalletStats>();
    private readonly txs: TransactionSummary[] = [];

    constructor({ max }: { max: number }) {
        this.max = Math.max(1, max);
    }

    updateWallet(stats: WalletStats): void {
        const key = stats.address.toLowerCase();
        const existing = this.wallets.get(key);

        if (!existing || stats.lastSeen >= existing.lastSeen) {
            this.wallets.set(key, stats);
        }

        if (this.wallets.size > this.max) {
            // Simple eviction of oldest seen
            const oldest = Array.from(this.wallets.entries())
                .sort(([, a], [, b]) => a.lastSeen - b.lastSeen)
                .slice(0, 100);
            for (const [k] of oldest) this.wallets.delete(k);
        }
    }

    addTransactions(newTxs: TransactionSummary[]): void {
        this.txs.push(...newTxs);
        if (this.txs.length > this.max) {
            this.txs.splice(0, this.txs.length - this.max);
        }
    }

    listActive(limit = 100): WalletStats[] {
        return Array.from(this.wallets.values())
            .sort((a, b) => b.lastSeen - a.lastSeen)
            .slice(0, limit);
    }

    listRich(limit = 100): WalletStats[] {
        return Array.from(this.wallets.values())
            .sort((a, b) => {
                const diff = BigInt(b.balance) - BigInt(a.balance);
                return diff > 0n ? 1 : diff < 0n ? -1 : 0;
            })
            .slice(0, limit);
    }

    getWallet(address: string): WalletStats | undefined {
        return this.wallets.get(address.toLowerCase());
    }
}
