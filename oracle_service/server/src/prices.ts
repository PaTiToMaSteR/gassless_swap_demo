import { ethers } from "ethers";

export class PriceFetcher {
    constructor() { }

    async fetchPrices(): Promise<Record<string, number>> {
        try {
            // Free API, rate limited.
            // ids: usd-coin (USDC), binancecoin (BNB), avalanche-2 (AVAX)
            const res = await fetch(
                "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,binancecoin,avalanche-2&vs_currencies=usd"
            );
            if (!res.ok) throw new Error(`HTPP ${res.status}`);
            const data = await res.json() as any;

            const usdcUsd = data["usd-coin"]?.usd;
            const bnbUsd = data["binancecoin"]?.usd;
            const avaxUsd = data["avalanche-2"]?.usd;

            if (!usdcUsd || !bnbUsd || !avaxUsd) throw new Error("Missing price data");

            // Calculate price in AVAX (ETH) for 1 unit of token
            // Price = (Token/USD) / (AVAX/USD)
            const usdcRate = usdcUsd / avaxUsd;
            const bnbRate = bnbUsd / avaxUsd;

            return {
                USDC: usdcRate,
                BNB: bnbRate,
            };
        } catch (e) {
            console.warn("Failed to fetch fresh prices, using simulation:", e);
            return this.simulatePrices();
        }
    }

    private simulatePrices(): Record<string, number> {
        // Approx 1 AVAX = $40
        // 1 USDC = $1 = 0.025 AVAX
        // 1 BNB = $600 = 15 AVAX

        // Add random noise +/- 1%
        const noise = () => 1 + (Math.random() * 0.02 - 0.01);

        return {
            USDC: 0.025 * noise(),
            BNB: 15.0 * noise(),
        };
    }
}
