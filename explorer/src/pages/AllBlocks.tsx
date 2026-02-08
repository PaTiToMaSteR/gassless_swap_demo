import { useLatestBlocks } from '../hooks/useBlockchain';
import { Link } from 'react-router-dom';
import { Layers, Clock, ArrowLeft } from 'lucide-react';
import { truncateHash } from '../lib/utils';

export default function AllBlocks() {
    const { blocks, loading } = useLatestBlocks(50); // Fetch more for the full list

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-4">
                <Link to="/" className="p-1.5 rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.1)] transition-all">
                    <ArrowLeft className="h-4 w-4 text-[var(--muted)]" />
                </Link>
                <h2 className="text-lg font-semibold text-[var(--text)] flex items-center">
                    <Layers className="h-5 w-5 mr-3 text-[var(--accent)]" />
                    All Blocks
                </h2>
            </div>

            <div className="panel">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-[var(--border)]">
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Height</th>
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Age</th>
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Transactions</th>
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Miner</th>
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Gas Used</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="py-8 text-center text-[var(--muted)] text-sm">Loading blocks...</td>
                                </tr>
                            ) : blocks.map((block) => (
                                <tr key={block.hash} className="hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                                    <td className="py-4">
                                        <Link to={`/block/${block.number}`} className="text-sm font-mono text-[var(--accent)] hover:underline">
                                            #{block.number}
                                        </Link>
                                    </td>
                                    <td className="py-4 text-xs text-[var(--text)]">
                                        <div className="flex items-center gap-1.5">
                                            <Clock size={12} className="text-[var(--faint)]" />
                                            {new Date(Number(block.timestamp) * 1000).toLocaleTimeString()}
                                        </div>
                                    </td>
                                    <td className="py-4">
                                        <span className="pill text-[10px]">{block.transactions.length} txs</span>
                                    </td>
                                    <td className="py-4">
                                        <Link to={`/address/${block.miner}`} className="text-xs font-mono text-[var(--muted)] hover:text-[var(--text)]">
                                            {truncateHash(block.miner, 10, 8)}
                                        </Link>
                                    </td>
                                    <td className="py-4">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-[10px] text-[var(--text)] font-mono">
                                                {block.gasUsed.toString()}
                                            </span>
                                            <div className="w-24 bg-[rgba(255,255,255,0.05)] rounded-full h-1 overflow-hidden">
                                                <div
                                                    className="bg-[var(--accent)] h-full"
                                                    style={{ width: `${Math.min(100, (Number(block.gasUsed) / Number(block.gasLimit)) * 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
