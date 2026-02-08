import fs from "node:fs";

export type OracleDeployments = {
    chainId: number;
    entryPoint: string;
    simpleAccountFactory: string;
    paymaster: string;
    router: string;
    oracle: string;
    tokenOut: string;
    usdc: string;
    bnb: string;
    usdcPool: string;
    bnbPool: string;
};

export function readDeployments(path: string): OracleDeployments {
    const raw = fs.readFileSync(path, "utf8");
    return JSON.parse(raw) as OracleDeployments;
}
