export type PriceEntry = {
    symbol: string;
    price: number; // in USD or Native Token? Let's say relative to TokenOut (Native)
    timestamp: number;
    source: string;
};

export type PriceLog = {
    ts: number;
    symbol: string;
    priceCheck: number; // The price we fetched
    priceOnChain: number; // The price currently on chain (before update)
    updated: boolean;
    txHash?: string;
    error?: string;
};

export type OracleStatus = {
    ready: boolean;
    lastUpdateTs: number;
    prices: Record<string, number>; // symbol -> processed price
};
