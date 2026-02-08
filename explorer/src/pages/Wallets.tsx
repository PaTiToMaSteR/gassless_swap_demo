import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, TrendingUp, Filter, Wallet, ArrowUpRight } from 'lucide-react';
import { truncateHash, formatEth } from '../lib/utils';

interface WalletStats {
    address: string;
    balance: string;
    txCount: number;
    lastSeen: number;
}

export default function Wallets() {
    const [activeWallets, setActiveWallets] = useState<WalletStats[]>([]);
    const [richList, setRichList] = useState<WalletStats[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const monitorUrl = 'http://127.0.0.1:3002/api/public';
                const [activeRes, richRes] = await Promise.all([
                    fetch(`${monitorUrl}/wallets/active?limit=25`),
                    fetch(`${monitorUrl}/wallets/rich?limit=25`)
                ]);

                if (activeRes.ok) setActiveWallets(await activeRes.json());
                richRes.ok && setRichList(await richRes.json());
            } catch (err) {
                console.error("Failed to fetch wallet analytics:", err);
            }
            setLoading(false);
        };
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[var(--text)] flex items-center">
                    <Users className="h-5 w-5 mr-3 text-purple-400" />
                    Wallet Analytics
                </h2>
                <div className="flex items-center gap-2 text-[10px] text-[var(--faint)] bg-[rgba(255,255,255,0.03)] px-3 py-1 rounded-full border border-[var(--border)]">
                    <Filter size={10} />
                    <span>Analyzing Live Traffic</span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Active Wallets */}
                <div className="panel">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={16} className="text-[var(--accent)]" />
                            <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Recently Active</h3>
                        </div>
                        <span className="text-[10px] text-[var(--faint)]">{activeWallets.length} discovered</span>
                    </div>

                    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                        {loading ? (
                            <div className="py-8 text-center text-[var(--muted)] text-sm">Analyzing blocks...</div>
                        ) : activeWallets.length === 0 ? (
                            <div className="py-8 text-center text-[var(--faint)] text-xs border border-dashed border-[var(--border)] rounded-xl">No active traffic detected recently</div>
                        ) : (
                            activeWallets.map(w => (
                                <Link key={w.address} to={`/address/${w.address}`} className="flex items-center justify-between p-3 rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] transition-all group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-[var(--accent)]">
                                            <Wallet size={14} />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-mono text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">{truncateHash(w.address, 8, 8)}</span>
                                            <span className="text-[10px] text-[var(--faint)]">Nonce: {w.txCount}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="text-xs font-medium text-[var(--good)]">{formatEth(w.balance)} ETH</span>
                                        <span className="text-[9px] text-[var(--faint)]">Last Active: {new Date(w.lastSeen * 1000).toLocaleTimeString()}</span>
                                    </div>
                                </Link>
                            ))
                        )}
                    </div>
                </div>

                {/* Rich List */}
                <div className="panel">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <ArrowUpRight size={16} className="text-yellow-400" />
                            <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Top Holders (Discovered)</h3>
                        </div>
                    </div>

                    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                        {loading ? (
                            <div className="py-8 text-center text-[var(--muted)] text-sm">Calculating balances...</div>
                        ) : richList.length === 0 ? (
                            <div className="py-8 text-center text-[var(--faint)] text-xs border border-dashed border-[var(--border)] rounded-xl">No wallets discovered yet</div>
                        ) : (
                            richList.map((w, i) => (
                                <Link key={w.address} to={`/address/${w.address}`} className="flex items-center justify-between p-3 rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] transition-all group">
                                    <div className="flex items-center gap-3">
                                        <span className="text-[10px] font-mono text-[var(--faint)] w-4">#{i + 1}</span>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-mono text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">{truncateHash(w.address, 10, 10)}</span>
                                            <span className="text-[10px] text-[var(--faint)]">Activity Nonce: {w.txCount}</span>
                                        </div>
                                    </div>
                                    <span className="text-sm font-semibold text-[var(--good)]">{formatEth(w.balance)} ETH</span>
                                </Link>
                            ))
                        )}
                    </div>
                </div>
            </div>
            <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/10 text-center">
                <p className="text-[10px] text-purple-300">
                    Discovered wallets are derived from scanning the most recent blocks. A full rich list requires a complete blockchain indexer.
                </p>
            </div>
        </div>
    );
}
