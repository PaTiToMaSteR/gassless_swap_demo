import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Box, ArrowLeft, ArrowRight } from 'lucide-react';
import { truncateHash, formatEth } from '../lib/utils';
import { JsonRpcProvider, TransactionResponse } from 'ethers';

const RPC_URL = import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545';
const provider = new JsonRpcProvider(RPC_URL);

export default function AllTransactions() {
    const [txs, setTxs] = useState<TransactionResponse[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTxs = async () => {
            setLoading(true);
            try {
                const blockNumber = await provider.getBlockNumber();
                const promises = [];
                for (let i = 0; i < 5; i++) { // Reduce to 5 blocks to speed up receipt fetching
                    if (blockNumber - i < 0) break;
                    promises.push(provider.getBlock(blockNumber - i, true));
                }
                const blocks = await Promise.all(promises);
                const aggregated: any[] = [];
                blocks.forEach(b => {
                    if (b && b.prefetchedTransactions) {
                        aggregated.push(...(b.prefetchedTransactions as any[]));
                    }
                });

                // Fetch receipts in parallel for first 30
                const enriched = await Promise.all(aggregated.slice(0, 30).map(async (tx) => {
                    try {
                        const receipt = await provider.getTransactionReceipt(tx.hash);
                        return { ...tx, receipt };
                    } catch {
                        return tx;
                    }
                }));

                setTxs(enriched);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchTxs();
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-4">
                <Link to="/" className="p-1.5 rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.1)] transition-all">
                    <ArrowLeft className="h-4 w-4 text-[var(--muted)]" />
                </Link>
                <h2 className="text-lg font-semibold text-[var(--text)] flex items-center">
                    <Box className="h-5 w-5 mr-3 text-[var(--good)]" />
                    All Transactions
                </h2>
            </div>

            <div className="panel">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-[var(--border)]">
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Hash</th>
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Block</th>
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">From / To</th>
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Value</th>
                                <th className="pb-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Fee</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="py-8 text-center text-[var(--muted)] text-sm">Loading transactions...</td>
                                </tr>
                            ) : txs.map((tx) => (
                                <tr key={tx.hash} className="hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                                    <td className="py-4">
                                        <Link to={`/tx/${tx.hash}`} className="text-xs font-mono text-[var(--accent)] hover:underline">
                                            {truncateHash(tx.hash, 10, 8)}
                                        </Link>
                                    </td>
                                    <td className="py-4">
                                        <Link to={`/block/${tx.blockNumber}`} className="text-xs font-mono text-[var(--muted)] hover:text-[var(--text)]">
                                            {tx.blockNumber}
                                        </Link>
                                    </td>
                                    <td className="py-4">
                                        <div className="flex items-center gap-2">
                                            <Link to={`/address/${tx.from}`} className="text-[10px] font-mono text-[var(--text)] hover:text-[var(--accent)]">{truncateHash(tx.from, 6, 4)}</Link>
                                            <ArrowRight size={10} className="text-[var(--faint)]" />
                                            <Link to={`/address/${tx.to}`} className="text-[10px] font-mono text-[var(--text)] hover:text-[var(--accent)]">{tx.to ? truncateHash(tx.to, 6, 4) : 'Contract'}</Link>
                                        </div>
                                    </td>
                                    <td className="py-4">
                                        <span className="text-xs font-medium text-[var(--good)]">{formatEth(tx.value)} ETH</span>
                                    </td>
                                    <td className="py-4">
                                        <span className="text-[10px] text-[var(--muted)] font-mono">
                                            {(tx as any).receipt ? formatEth(BigInt((tx as any).receipt.gasUsed) * BigInt((tx as any).receipt.gasPrice || (tx as any).receipt.effectiveGasPrice || 0)) :
                                                (tx.gasPrice ? formatEth(tx.gasPrice * 21000n) : '—')}
                                        </span>
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
