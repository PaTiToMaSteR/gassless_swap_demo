import { useParams, Link } from 'react-router-dom';
import { useTransaction } from '../hooks/useBlockchain';
import { formatEth } from '../lib/utils';
import { ArrowLeft, FileText, CheckCircle, XCircle, Hash, Clock, Cpu } from 'lucide-react';

export default function TxDetail() {
    const { txHash } = useParams();
    const { tx, receipt, loading } = useTransaction(txHash);

    if (loading) return <div className="p-8 text-center text-[var(--muted)] text-sm">Loading transaction data...</div>;
    if (!tx) return <div className="p-8 text-center text-[var(--bad)] text-sm">Transaction not found</div>;

    const isSuccess = receipt?.status === 1;

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-4">
                <Link to="/" className="p-1.5 rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.1)] transition-all">
                    <ArrowLeft className="h-4 w-4 text-[var(--muted)]" />
                </Link>
                <h2 className="text-lg font-semibold text-[var(--text)] flex items-center">
                    <FileText className="h-5 w-5 mr-3 text-[var(--good)]" />
                    Transaction Details
                </h2>
            </div>

            <div className="panel">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Overview</h3>
                    {receipt ? (
                        <div className="flex gap-2">
                            {(tx as any).type === 4 && (
                                <div className="pill py-1 px-3 border-purple-500/30 text-purple-400 bg-purple-500/5">EIP-7702 Bundle</div>
                            )}
                            <div className={`pill ${isSuccess ? 'good' : 'bad'} py-1 px-3`}>
                                {isSuccess ? <CheckCircle className="w-3 h-3 mr-1.5" /> : <XCircle className="w-3 h-3 mr-1.5" />}
                                {isSuccess ? 'Success' : 'Failed'}
                            </div>
                        </div>
                    ) : (
                        <div className="pill py-1 px-3 border-yellow-500/30 text-yellow-400">Pending</div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-12">
                    <div className="flex flex-col md:col-span-2">
                        <span className="text-[10px] text-[var(--faint)] mb-1 flex items-center gap-1">
                            <Hash size={10} />
                            Transaction Hash
                        </span>
                        <span className="text-xs font-mono text-[var(--text)] break-all">{tx.hash}</span>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--faint)] mb-1 flex items-center gap-1">
                            <Clock size={10} />
                            Block
                        </span>
                        <Link to={`/block/${tx.blockNumber}`} className="text-xs font-mono text-[var(--accent)] hover:underline">
                            {tx.blockNumber}
                        </Link>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--faint)] mb-1 flex items-center gap-1">
                            <Cpu size={10} />
                            Value
                        </span>
                        <span className="text-xs font-medium text-[var(--good)]">{formatEth(tx.value)} ETH</span>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--faint)] mb-1">From</span>
                        <Link to={`/address/${tx.from}`} className="text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] break-all truncate">
                            {tx.from}
                        </Link>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--faint)] mb-1">To</span>
                        {tx.to ? (
                            <Link to={`/address/${tx.to}`} className="text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] break-all truncate">{tx.to}</Link>
                        ) : (
                            <span className="text-xs text-[var(--faint)] italic">Contract Creation</span>
                        )}
                    </div>

                    <div className="flex flex-col md:col-span-2">
                        <span className="text-[10px] text-[var(--faint)] mb-1">Input Data</span>
                        <div className="p-3 rounded-xl bg-[rgba(0,0,0,0.3)] border border-[var(--border)] max-h-40 overflow-y-auto text-[10px] font-mono text-[var(--muted)] break-all whitespace-pre-wrap">
                            {tx.data}
                        </div>
                    </div>

                    {(tx as any).authorizationList && (tx as any).authorizationList.length > 0 && (
                        <div className="flex flex-col md:col-span-2">
                            <span className="text-[10px] text-[var(--faint)] mb-1">EIP-7702 Authorizations</span>
                            <div className="space-y-2">
                                {(tx as any).authorizationList.map((auth: any, idx: number) => (
                                    <div key={idx} className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 text-[10px] font-mono">
                                        <div className="flex justify-between mb-1">
                                            <span className="text-purple-400">Address:</span>
                                            <Link to={`/address/${auth.address}`} className="text-[var(--text)] hover:underline">{auth.address}</Link>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-purple-400">Chain ID:</span>
                                            <span className="text-[var(--text)]">{auth.chainId}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
