import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Search, Home, Activity, Layers, Users, Settings } from 'lucide-react';
import { isAddress, isHexString } from 'ethers';

export function Navbar() {
    const [query, setQuery] = useState<string>('');
    const navigate = useNavigate();

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const q = query.trim();
        if (!q) return;

        const isAddr = isAddress(q);
        if (isAddr) {
            navigate(`/address/${q}`);
            return;
        }

        const qStr = q as string;
        const isTxOrBlock = qStr.length === 66 && isHexString(qStr);
        if (isTxOrBlock) {
            navigate(`/tx/${q}`);
            return;
        }

        const isBlockNum = /^\d+$/.test(q);
        if (isBlockNum) {
            navigate(`/block/${q}`);
            return;
        }

        console.warn("Unknown search query format");
    };

    return (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[rgba(0,0,0,0.2)]">
            <div className="flex gap-4">
                <Link to="/" className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-sm font-medium">
                    <Home size={16} />
                    Dashboard
                </Link>
                <Link to="/wallets" className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-sm font-medium">
                    <Users size={16} />
                    Wallets
                </Link>
                <Link to="/registry" className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-sm font-medium">
                    <Settings size={16} />
                    Registry
                </Link>
            </div>

            <div className="flex-1 max-w-md mx-4">
                <form onSubmit={handleSearch} className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-[var(--faint)]" aria-hidden="true" />
                    </div>
                    <input
                        id="search"
                        className="block w-full pl-9 pr-3 py-1.5 text-xs bg-[rgba(0,0,0,0.3)] border border-[var(--border)] rounded-lg text-[var(--text)] placeholder-[var(--faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-all"
                        placeholder="Search by Address / Tx Hash / Block"
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </form>
            </div>

            <div className="flex gap-4 text-[var(--faint)] text-xs">
                <div className="flex items-center gap-1">
                    <Layers size={14} />
                    <span>Mainnet Fork</span>
                </div>
                <div className="flex items-center gap-1">
                    <Activity size={14} />
                    <span className="text-[var(--good)]">Connected</span>
                </div>
            </div>
        </div>
    );
}
