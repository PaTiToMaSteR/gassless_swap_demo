import { PriceFetcher } from "./prices";
import { Publisher } from "./publisher";
import { OracleConfig } from "./config";
import { OracleDeployments } from "./deployments";
import { OracleStatus, PriceLog } from "./types";

export class OracleService {
    private fetcher: PriceFetcher;
    private publisher: Publisher;
    private timer?: NodeJS.Timeout;

    public status: OracleStatus = {
        ready: false,
        lastUpdateTs: 0,
        prices: {},
    };

    public logs: PriceLog[] = [];

    constructor(
        readonly config: OracleConfig,
        readonly deployments: OracleDeployments
    ) {
        this.fetcher = new PriceFetcher();
        this.publisher = new Publisher(config, deployments);
    }

    async start() {
        this.status.ready = true;
        this.runLoop();
        this.timer = setInterval(() => this.runLoop(), this.config.updateIntervalSec * 1000);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.status.ready = false;
    }

    async runLoop() {
        console.log("Oracle Update Loop...");
        try {
            const prices = await this.fetcher.fetchPrices(); // { USDC: 0.025, BNB: 15.0 }

            const priceOf = (symbol: string) => prices[symbol];

            this.status.prices = prices;
            this.status.lastUpdateTs = Date.now();

            // Update USDC
            await this.updateToken("USDC", priceOf("USDC"));

            // Update BNB
            await this.updateToken("BNB", priceOf("BNB"));

        } catch (e) {
            console.error("Oracle Loop Failed:", e);
        }
    }

    private async updateToken(symbol: string, price: number) {
        if (!price) return;
        try {
            const tx = await this.publisher.setPrice(symbol, price);
            this.log({
                ts: Date.now(),
                symbol,
                priceCheck: price,
                priceOnChain: price, // Optimistic
                updated: true,
                txHash: tx,
            });
            console.log(`Updated ${symbol} to ${price} (tx: ${tx})`);
        } catch (e: any) {
            this.log({
                ts: Date.now(),
                symbol,
                priceCheck: price,
                priceOnChain: 0,
                updated: false,
                error: e.message
            });
            console.error(`Failed to update ${symbol}:`, e);
        }
    }

    private log(entry: PriceLog) {
        this.logs.unshift(entry);
        if (this.logs.length > 100) this.logs.pop();
    }

    async manualUpdate() {
        await this.runLoop();
    }
}
