import { useParams, Link } from 'react-router-dom';
import { useAddress } from '../hooks/useBlockchain';
import { ArrowLeft, Wallet, CreditCard, Activity, Hash } from 'lucide-react';

export default function AddressDetail() {
    const { address } = useParams();
    const { balance, txCount, is7702, delegatedTo, loading } = useAddress(address);

    if (loading) return <div className="p-8 text-center text-[var(--muted)] text-sm">Loading address data...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-4">
                <Link to="/" className="p-1.5 rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.1)] transition-all">
                    <ArrowLeft className="h-4 w-4 text-[var(--muted)]" />
                </Link>
                <h2 className="text-lg font-semibold text-[var(--text)] flex items-center">
                    <Wallet className="h-5 w-5 mr-3 text-purple-400" />
                    Address Details
                </h2>
            </div>

            <div className="panel">
                <div className="flex flex-col">
                    <span className="text-[10px] text-[var(--faint)] mb-1 flex items-center gap-1">
                        <Hash size={10} />
                        Address
                    </span>
                    <span className="text-sm font-mono text-[var(--text)] break-all">{address}</span>
                </div>
            </div>

            <div className="kpis">
                <div className="kpi flex items-center gap-4">
                    <div className="p-2 rounded-xl bg-green-500/10 text-green-400">
                        <CreditCard size={20} />
                    </div>
                    <div>
                        <h3 className="text-[10px] font-medium text-[var(--muted)] mb-0.5">ETH Balance</h3>
                        <p className="text-xl font-semibold text-[var(--text)]">{balance} ETH</p>
                    </div>
                </div>
                <div className="kpi flex items-center gap-4">
                    <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
                        <Activity size={20} />
                    </div>
                    <div>
                        <h3 className="text-[10px] font-medium text-[var(--muted)] mb-0.5">Transaction Count</h3>
                        <p className="text-xl font-semibold text-[var(--text)]">{txCount}</p>
                    </div>
                </div>
                {is7702 && (
                    <div className="kpi flex items-center gap-4 border-purple-500/30 bg-purple-500/5">
                        <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
                            <Hash size={20} />
                        </div>
                        <div>
                            <h3 className="text-[10px] font-medium text-purple-400 mb-0.5">EIP-7702 Active</h3>
                            <p className="text-xs font-mono text-purple-300">Delegated to {delegatedTo?.slice(0, 10)}...</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="panel">
                <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Recent Activity</h3>
                <div className="p-4 rounded-xl bg-[rgba(0,0,0,0.2)] border border-[var(--border)] border-dashed">
                    <p className="text-[var(--muted)] text-xs text-center leading-relaxed">
                        Full transaction history requires an indexed backend.<br />
                        Only basic address info is currently available via RPC.
                    </p>
                </div>
            </div>
        </div>
    );
}
