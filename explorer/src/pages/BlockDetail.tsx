import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useBlock, RPC_URL } from '../hooks/useBlockchain';
import { truncateHash, formatEth } from '../lib/utils';
import { ArrowLeft, Box, Clock, User, Hash, ArrowRight } from 'lucide-react';
import { JsonRpcProvider } from 'ethers';

const provider = new JsonRpcProvider(RPC_URL);

export default function BlockDetail() {
    const { blockNumber } = useParams();
    const { block, loading } = useBlock(blockNumber);
    const [enrichedTxs, setEnrichedTxs] = useState<any[]>([]);

    useEffect(() => {
        const fetchReceipts = async () => {
            if (block && block.transactions) {
                const enriched = await Promise.all(block.transactions.map(async (tx: any) => {
                    try {
                        const receipt = await provider.getTransactionReceipt(typeof tx === 'string' ? tx : tx.hash);
                        return { ...(typeof tx === 'string' ? { hash: tx } : tx), receipt };
                    } catch {
                        return typeof tx === 'string' ? { hash: tx } : tx;
                    }
                }));
                setEnrichedTxs(enriched);
            }
        };
        fetchReceipts();
    }, [block]);

    if (loading) return <div className="p-8 text-center text-[var(--muted)] text-sm">Loading block data...</div>;
    if (!block) return <div className="p-8 text-center text-[var(--bad)] text-sm">Block not found</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-4">
                <Link to="/" className="p-1.5 rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.1)] transition-all">
                    <ArrowLeft className="h-4 w-4 text-[var(--muted)]" />
                </Link>
                <h2 className="text-lg font-semibold text-[var(--text)] flex items-center">
                    <Box className="h-5 w-5 mr-3 text-[var(--accent)]" />
                    Block #{block.number}
                </h2>
            </div>

            <div className="panel">
                <div className="mb-4">
                    <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Overview</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-12">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--faint)] mb-1">Block Height</span>
                        <span className="text-sm font-mono text-[var(--text)]">{block.number}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--faint)] mb-1">Timestamp</span>
                        <span className="text-sm text-[var(--text)] flex items-center">
                            <Clock className="h-3 w-3 mr-1.5 text-[var(--faint)]" />
                            {new Date(Number(block.timestamp) * 1000).toLocaleString()}
                        </span>
                    </div>
                    <div className="flex flex-col md:col-span-2">
                        <span className="text-[10px] text-[var(--faint)] mb-1 flex items-center gap-1">
                            <Hash size={10} />
                            Hash
                        </span>
                        <span className="text-xs font-mono text-[var(--muted)] break-all">{block.hash}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--faint)] mb-1 flex items-center gap-1">
                            <User size={10} />
                            Miner
                        </span>
                        <Link to={`/address/${block.miner}`} className="text-xs font-mono text-[var(--accent)] hover:underline truncate">
                            {block.miner}
                        </Link>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--faint)] mb-1">Gas Usage</span>
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-[var(--text)]">
                                {block.gasUsed.toString()} / {block.gasLimit.toString()}
                            </span>
                            <div className="flex-1 bg-[rgba(255,255,255,0.05)] rounded-full h-1.5 max-w-[120px] overflow-hidden">
                                <div
                                    className="bg-[var(--accent)] h-full rounded-full"
                                    style={{ width: `${Math.min(100, (Number(block.gasUsed) / Number(block.gasLimit)) * 100)}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col md:col-span-2">
                        <span className="text-[10px] text-[var(--faint)] mb-1">Parent Hash</span>
                        <Link to={`/block/${block.parentHash}`} className="text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] break-all">
                            {block.parentHash}
                        </Link>
                    </div>
                </div>
            </div>

            <div className="panel">
                <div className="mb-4">
                    <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Transactions ({block.transactions.length})</h3>
                </div>
                <div className="grid grid-cols-1 gap-2">
                    {(enrichedTxs.length > 0 ? enrichedTxs : block.transactions).map((tx: any) => (
                        <div key={tx.hash || tx} className="p-3 rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] transition-all">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                                <div className="flex flex-col">
                                    <Link to={`/tx/${tx.hash || tx}`} className="text-xs font-mono text-[var(--accent)] hover:underline truncate max-w-[200px]">
                                        {tx.hash || tx}
                                    </Link>
                                    {tx.from && (
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <Link to={`/address/${tx.from}`} className="text-[10px] text-[var(--muted)] hover:text-[var(--text)] font-mono">{truncateHash(tx.from, 6, 4)}</Link>
                                            <ArrowRight size={10} className="text-[var(--faint)]" />
                                            <Link to={`/address/${tx.to}`} className="text-[10px] text-[var(--muted)] hover:text-[var(--text)] font-mono">{tx.to ? truncateHash(tx.to, 6, 4) : 'Contract'}</Link>
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex flex-col items-end">
                                        <span className="text-[10px] text-[var(--good)] font-medium">
                                            {formatEth(tx.value || 0)} ETH
                                        </span>
                                        <span className="text-[9px] text-[var(--faint)] font-mono mt-0.5">
                                            {(tx as any).receipt ? `Fee: ${formatEth(BigInt((tx as any).receipt.gasUsed) * BigInt((tx as any).receipt.gasPrice || (tx as any).receipt.effectiveGasPrice || 0))} ETH` :
                                                (tx.gasLimit ? `Gas: ${tx.gasLimit.toString()}` : '—')}
                                        </span>
                                    </div>
                                    <Link to={`/tx/${tx.hash || tx}`} className="p-1 px-2 text-[10px] rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)]">
                                        Details
                                    </Link>
                                </div>
                            </div>
                        </div>
                    ))}
                    {block.transactions.length === 0 && (
                        <div className="py-8 text-[var(--muted)] text-xs text-center border border-dashed border-[var(--border)] rounded-xl uppercase tracking-tighter">
                            No transactions in this block
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
