import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

import { OracleConfig } from "./config";
import { OracleDeployments } from "./deployments";

export class Publisher {
    private readonly provider: ethers.providers.JsonRpcProvider;
    private readonly signer: ethers.Wallet;
    private readonly oracle: ethers.Contract;

    constructor(
        readonly config: OracleConfig,
        readonly deployments: OracleDeployments
    ) {
        this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
        this.signer = new ethers.Wallet(config.deployerPrivateKey, this.provider);

        // We expect abis to be in ../abis relative to deployments file
        const abisDir = path.join(path.dirname(config.deploymentsPath), "abis");
        const abiPath = path.join(abisDir, "MockPriceOracle.abi.json"); // export-abis.sh naming convention

        // Fallback if file doesn't exist (e.g. running from different location), use inline or try another path
        // For now assuming standard structure from export-abis.sh
        let abi: any;
        try {
            abi = JSON.parse(fs.readFileSync(abiPath, "utf8"));
        } catch (e) {
            console.warn(`Could not read ABI from ${abiPath}, using inline minimal ABI`);
            abi = [
                "function setPrice(address token, uint256 priceInWei, uint8 decimals) external",
                "function getPrice(address token) external view returns (uint256)",
                "function decimals(address token) external view returns (uint8)",
                "function owner() view returns (address)",
            ];
        }

        this.oracle = new ethers.Contract(deployments.oracle, abi, this.signer);
    }

    async setPrice(tokenArg: string, price: number): Promise<string> {
        // price is "Native Token per Token" (e.g. 0.025 AVAX per USDC)
        // We need to convert to Wei (1e18) * price
        // But wait, getPrice returns uint256 priceInWei?
        // In MockPriceOracle: 
        // uint256 fairOut = (swapAmountIn * oraclePriceInWei) / (10 ** oracle.decimals(tokenIn));
        // If swapAmountIn = 1e6 (1 USDC), and we want 0.025 AVAX (2.5e16 Wei).
        // 2.5e16 = (1e6 * P) / 1e6 => P = 2.5e16.
        // So P is price of 1 full token unit (10^decimals) in Wei.

        // If price is 0.025 (AVAX/USDC), then P = 0.025 * 1e18 = 2.5e16.

        const token = tokenArg.toLowerCase() === "usdc" ? this.deployments.usdc :
            tokenArg.toLowerCase() === "bnb" ? this.deployments.bnb :
                tokenArg;

        if (!token.startsWith("0x")) {
            throw new Error(`Unknown token symbol: ${tokenArg}`);
        }

        const priceInWei = ethers.utils.parseEther(price.toFixed(18));

        // Decimals? We need to know token decimals.
        // We can fetch it or hardcode.
        // Mock tokens: USDC=6, BNB=18 usually? 
        // Let's fetch it from contract or just guess. 
        // Ideally we fetch it once.

        // For now, let's just pass 18 for BNB and 6 for USDC if we know them.
        // Or just fetch it.

        const erc20 = new ethers.Contract(token, ["function decimals() view returns (uint8)"], this.provider);
        const decimals = await erc20.decimals();

        const tx = await this.oracle.setPrice(token, priceInWei, decimals);
        await tx.wait();

        return tx.hash;
    }
}
