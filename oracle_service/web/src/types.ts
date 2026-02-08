export type PriceLog = {
    ts: number;
    symbol: string;
    priceCheck: number;
    priceOnChain: number;
    updated: boolean;
    txHash?: string;
    error?: string;
};

export type OracleStatus = {
    ready: boolean;
    lastUpdateTs: number;
    prices: Record<string, number>;
};
