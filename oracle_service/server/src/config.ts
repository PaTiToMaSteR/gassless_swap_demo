export type OracleConfig = {
    host: string;
    port: number;
    rpcUrl: string;
    deploymentsPath: string;
    deployerPrivateKey: string;
    updateIntervalSec: number;
};

function parseIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${name}: ${raw}`);
    return parsed;
}

export function readConfigFromEnv(): OracleConfig {
    const host = process.env.HOST ?? "127.0.0.1";
    const port = parseIntEnv("PORT", 3003);
    const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";

    const deploymentsPath = process.env.DEPLOYMENTS_PATH;
    if (!deploymentsPath) throw new Error("DEPLOYMENTS_PATH is required");

    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!deployerPrivateKey) throw new Error("DEPLOYER_PRIVATE_KEY is required");

    const updateIntervalSec = parseIntEnv("UPDATE_INTERVAL_SEC", 10);

    return { host, port, rpcUrl, deploymentsPath, deployerPrivateKey, updateIntervalSec };
}
