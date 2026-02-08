import { Link } from 'react-router-dom';
import { Settings, Shield, Zap, Coins, Landmark } from 'lucide-react';

const SYSTEM_ADDRESSES = {
    chainId: 31337,
    entryPoint: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    simpleAccountFactory: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    paymaster: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    router: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    pool: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    tokenIn: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    tokenOut: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
};

export default function Registry() {
    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-4">
                <h2 className="text-lg font-semibold text-[var(--text)] flex items-center">
                    <Settings className="h-5 w-5 mr-3 text-[var(--accent)]" />
                    System Registry
                </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Core Architecture */}
                <div className="panel">
                    <div className="flex items-center gap-2 mb-4">
                        <Shield size={16} className="text-purple-400" />
                        <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Account Abstraction</h3>
                    </div>
                    <div className="space-y-4">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-[var(--faint)] mb-1">EntryPoint (v0.7)</span>
                            <Link to={`/address/${SYSTEM_ADDRESSES.entryPoint}`} className="text-sm font-mono text-[var(--accent)] hover:underline truncate">
                                {SYSTEM_ADDRESSES.entryPoint}
                            </Link>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-[var(--faint)] mb-1">Account Factory</span>
                            <Link to={`/address/${SYSTEM_ADDRESSES.simpleAccountFactory}`} className="text-sm font-mono text-[var(--accent)] hover:underline truncate">
                                {SYSTEM_ADDRESSES.simpleAccountFactory}
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Infrastructure */}
                <div className="panel">
                    <div className="flex items-center gap-2 mb-4">
                        <Zap size={16} className="text-yellow-400" />
                        <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Paymaster & Routing</h3>
                    </div>
                    <div className="space-y-4">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-[var(--faint)] mb-1">Sponsored Paymaster</span>
                            <Link to={`/address/${SYSTEM_ADDRESSES.paymaster}`} className="text-sm font-mono text-[var(--accent)] hover:underline truncate">
                                {SYSTEM_ADDRESSES.paymaster}
                            </Link>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-[var(--faint)] mb-1">Universal Router</span>
                            <Link to={`/address/${SYSTEM_ADDRESSES.router}`} className="text-sm font-mono text-[var(--accent)] hover:underline truncate">
                                {SYSTEM_ADDRESSES.router}
                            </Link>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-[var(--faint)] mb-1">Liquidity Pool</span>
                            <Link to={`/address/${SYSTEM_ADDRESSES.pool}`} className="text-sm font-mono text-[var(--accent)] hover:underline truncate">
                                {SYSTEM_ADDRESSES.pool}
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Tokens */}
                <div className="panel md:col-span-2">
                    <div className="flex items-center gap-2 mb-4">
                        <Coins size={16} className="text-green-400" />
                        <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Registered ERC20 Tokens</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-[var(--text)]">Token IN</span>
                                <span className="pill py-0 px-2 text-[9px] uppercase">Collateral</span>
                            </div>
                            <Link to={`/address/${SYSTEM_ADDRESSES.tokenIn}`} className="text-xs font-mono text-[var(--accent)] hover:underline break-all">
                                {SYSTEM_ADDRESSES.tokenIn}
                            </Link>
                        </div>
                        <div className="p-3 rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-[var(--text)]">Token OUT</span>
                                <span className="pill py-0 px-2 text-[9px] uppercase">Fees</span>
                            </div>
                            <Link to={`/address/${SYSTEM_ADDRESSES.tokenOut}`} className="text-xs font-mono text-[var(--accent)] hover:underline break-all">
                                {SYSTEM_ADDRESSES.tokenOut}
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Network Info */}
                <div className="panel md:col-span-2 bg-blue-500/5">
                    <div className="flex items-center gap-2 mb-2 text-blue-400">
                        <Landmark size={14} />
                        <span className="text-xs font-medium uppercase tracking-tighter">Chain Configuration</span>
                    </div>
                    <div className="flex gap-8 text-[11px] font-mono text-[var(--muted)]">
                        <div>CHAIN_ID: <span className="text-[var(--text)]">{SYSTEM_ADDRESSES.chainId}</span></div>
                        <div>NETWORK: <span className="text-[var(--text)]">Local Foundry/Hardhat</span></div>
                        <div>RPC: <span className="text-[var(--text)]">http://127.0.0.1:8545</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
