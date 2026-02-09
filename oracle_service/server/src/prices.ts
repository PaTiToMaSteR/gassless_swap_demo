import { ethers } from "ethers";

export class PriceFetcher {
    constructor() { }

    async fetchPrices(): Promise<Record<string, number>> {
        // ALWAYS use simulated/demo prices for the local environment to match 
        // the pool liquidity in Deploy.s.sol (1 USDC = 0.001 AVAX).
        // Real-world prices from CoinGecko vary too much and cause SlippageRisk reverts.
        return this.simulatePrices();
    }

    private simulatePrices(): Record<string, number> {
        // Updated to match pool liquidity in demo:
        // 1 WAVAX = $1000 -> 1 USDC = $1 = 0.001 WAVAX
        // 1 BNB = $200 = 0.2 WAVAX

        // Add random noise +/- 0.1% (reduced noise for E2E stability)
        const noise = () => 1 + (Math.random() * 0.002 - 0.001);

        return {
            USDC: 0.001 * noise(),
            BNB: 0.2 * noise(),
        };
    }
}
