import { Link } from 'react-router-dom';
import { Box, Layers } from 'lucide-react';
import { useLatestBlocks, useLatestTransactions } from '../hooks/useBlockchain';
import { truncateHash, formatEth } from '../lib/utils';

export default function Dashboard() {
    const { blocks, loading: blocksLoading } = useLatestBlocks();
    const { transactions, loading: txsLoading } = useLatestTransactions();

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Latest Blocks */}
                <div className="panel flex flex-col h-[500px]">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-[var(--text)] flex items-center">
                            <Layers className="h-4 w-4 mr-2 text-[var(--accent)]" />
                            Latest Blocks
                        </h3>
                        <Link to="/blocks" className="text-xs text-[var(--accent)] hover:underline">
                            View all
                        </Link>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0">
                        {blocksLoading ? (
                            <div className="py-8 text-center text-[var(--muted)] text-sm">Loading blocks...</div>
                        ) : (
                            <div className="space-y-2">
                                {blocks.map((block) => (
                                    <div key={block.hash} className="p-3 rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] transition-all">
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col">
                                                <Link to={`/block/${block.number}`} className="text-sm font-mono text-[var(--accent)] hover:underline">
                                                    #{block.number}
                                                </Link>
                                                <span className="text-[10px] text-[var(--faint)] mt-0.5">
                                                    {new Date(Number(block.timestamp) * 1000).toLocaleTimeString()}
                                                </span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-xs text-[var(--muted)] font-mono">
                                                    {truncateHash(block.miner)}
                                                </span>
                                                <span className="pill mt-1 py-0.5">
                                                    {block.transactions.length} Txs
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Latest Transactions */}
                <div className="panel flex flex-col h-[500px]">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-[var(--text)] flex items-center">
                            <Box className="h-4 w-4 mr-2 text-[var(--good)]" />
                            Latest Transactions
                        </h3>
                        <Link to="/txs" className="text-xs text-[var(--accent)] hover:underline">
                            View all
                        </Link>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0">
                        {txsLoading ? (
                            <div className="py-8 text-center text-[var(--muted)] text-sm">Loading transactions...</div>
                        ) : (
                            <div className="space-y-2">
                                {transactions.length === 0 ? (
                                    <div className="py-8 text-center text-[var(--muted)] text-sm">No recent transactions</div>
                                ) : transactions.map((tx) => (
                                    <div key={tx.hash} className="p-3 rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] transition-all">
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col">
                                                <Link to={`/tx/${tx.hash}`} className="text-sm font-mono text-[var(--accent)] hover:underline">
                                                    {truncateHash(tx.hash, 8, 8)}
                                                </Link>
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <span className="text-[10px] text-[var(--faint)]">From:</span>
                                                    <Link to={`/address/${tx.from}`} className="text-[10px] text-[var(--muted)] hover:text-[var(--text)] font-mono">{truncateHash(tx.from, 6, 4)}</Link>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] text-[var(--good)] font-medium">
                                                    {formatEth(tx.value)} ETH
                                                </span>
                                                <span className="text-[9px] text-[var(--faint)] font-mono mt-0.5">
                                                    Fee: {(tx as any).receipt ? formatEth(BigInt((tx as any).receipt.gasUsed) * BigInt((tx as any).receipt.gasPrice || (tx as any).receipt.effectiveGasPrice || 0)) : '—'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
