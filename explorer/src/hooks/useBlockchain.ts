import { useState, useEffect, useCallback } from 'react';
import { JsonRpcProvider, Block, TransactionResponse, formatEther } from 'ethers';

export const RPC_URL = import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545';
const provider = new JsonRpcProvider(RPC_URL);

// Types
export interface EnhancedBlock extends Block {
    transactionCount: number;
}

export function useLatestBlocks(limit = 10) {
    const [blocks, setBlocks] = useState<Block[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchBlocks = useCallback(async () => {
        try {
            const blockNumber = await provider.getBlockNumber();

            // Fetch last 'limit' blocks
            // In a real app, use multicall or careful concurrent requests
            const promises = [];
            for (let i = 0; i < limit; i++) {
                if (blockNumber - i < 0) break;
                promises.push(provider.getBlock(blockNumber - i));
            }

            const results = await Promise.all(promises);
            const validBlocks = results.filter((b): b is Block => b !== null);
            setBlocks(validBlocks);
            setError(null);
        } catch (err: any) {
            console.error('Failed to fetch blocks:', err);
            setError(err.message || 'Failed to fetch blocks');
        } finally {
            setLoading(false);
        }
    }, [limit]);

    useEffect(() => {
        fetchBlocks();
        const interval = setInterval(fetchBlocks, 12000); // Poll every 12s
        return () => clearInterval(interval);
    }, [fetchBlocks]);

    return { blocks, loading, error, refresh: fetchBlocks };
}

export function useLatestTransactions(limit = 10) {
    const [transactions, setTransactions] = useState<TransactionResponse[]>([]);
    const [loading, setLoading] = useState(true);

    // Note: Standard JSON-RPC doesn't efficiently give "latest transactions" across blocks 
    // without fetching full blocks. We'll extract them from the latest blocks.
    const fetchTxs = useCallback(async () => {
        try {
            const blockNumber = await provider.getBlockNumber();
            const latestBlock = await provider.getBlock(blockNumber, true); // true to prefetch txs
            if (latestBlock && latestBlock.prefetchedTransactions) {
                // Get txs from this block, maybe previous if not enough
                const txs = latestBlock.prefetchedTransactions.slice(0, limit);

                // Fetch receipts in parallel to get gasUsed / actual cost
                const enriched = await Promise.all(txs.map(async (tx: any) => {
                    try {
                        const receipt = await provider.getTransactionReceipt(tx.hash);
                        return { ...tx, receipt };
                    } catch {
                        return tx;
                    }
                }));

                setTransactions(enriched as any[]);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [limit]);

    useEffect(() => {
        fetchTxs();
        const interval = setInterval(fetchTxs, 12000);
        return () => clearInterval(interval);
    }, [fetchTxs]);

    return { transactions, loading };
}

export function useBlock(blockNumberOrHash: string | undefined) {
    const [block, setBlock] = useState<Block | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!blockNumberOrHash) return;
        const fetch = async () => {
            setLoading(true);
            try {
                // If it's a decimal string (block height), convert to Number for ethers v6
                const id = /^\d+$/.test(blockNumberOrHash) ? Number(blockNumberOrHash) : blockNumberOrHash;
                const b = await provider.getBlock(id, true);
                setBlock(b);
            } catch (e) { console.error(e); }
            setLoading(false);
        };
        fetch();
    }, [blockNumberOrHash]);

    return { block, loading };
}

export function useTransaction(txHash: string | undefined) {
    const [tx, setTx] = useState<TransactionResponse | null>(null);
    const [receipt, setReceipt] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!txHash) return;
        const fetch = async () => {
            setLoading(true);
            try {
                const [t, r] = await Promise.all([
                    provider.getTransaction(txHash),
                    provider.getTransactionReceipt(txHash)
                ]);
                setTx(t);
                setReceipt(r);
            } catch (e) { console.error(e); }
            setLoading(false);
        };
        fetch();
    }, [txHash]);

    return { tx, receipt, loading };
}

export function useAddress(address: string | undefined) {
    const [balance, setBalance] = useState<string>('0');
    const [txCount, setTxCount] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!address) return;
        const fetch = async () => {
            setLoading(true);
            try {
                const b = await provider.getBalance(address);
                const count = await provider.getTransactionCount(address);
                setBalance(formatEther(b));
                setTxCount(count);
            } catch (e) { console.error(e); }
            setLoading(false);
        };
        fetch();
    }, [address]);

    return { balance, txCount, loading };
}
