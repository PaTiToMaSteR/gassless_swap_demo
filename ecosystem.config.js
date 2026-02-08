module.exports = {
    apps: [
        {
            name: "monitor-backend",
            cwd: "./paymaster_monitor/server",
            script: "npm",
            args: "run dev",
            env: {
                PORT: 3002,
                RPC_URL: "http://127.0.0.1:8545",
                DEPLOYMENTS_PATH: "../../paymaster/deployments/local/addresses.json",
                ADMIN_TOKEN: "dev_admin_token",
                DATA_DIR: "../../output/local-dev/data/monitor",
                BUNDLER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
                BUNDLER_PORT_RANGE: "3100-3199"
            }
        },
        {
            name: "quote-service",
            cwd: "./quote_service",
            script: "npm",
            args: "run dev",
            env: {
                PORT: 3001,
                RPC_URL: "http://127.0.0.1:8545",
                DEPLOYMENTS_PATH: "../paymaster/deployments/local/addresses.json",
                DATA_DIR: "../output/local-dev/data/quote",
                LOG_INGEST_URL: "http://127.0.0.1:3002/api/logs/ingest"
            }
        },
        {
            name: "oracle-backend",
            cwd: "./oracle_service/server",
            script: "npm",
            args: "run dev",
            env: {
                PORT: 3003,
                RPC_URL: "http://127.0.0.1:8545",
                DEPLOYMENTS_PATH: "../../paymaster/deployments/local/addresses.json",
                DEPLOYER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
            }
        },
        {
            name: "oracle-frontend",
            cwd: "./oracle_service/web",
            script: "npm",
            args: "run dev -- --host 127.0.0.1 --port 5176"
        },
        {
            name: "user-frontend",
            cwd: "./web",
            script: "npm",
            args: "run dev -- --host 127.0.0.1 --port 5173",
            env: {
                VITE_RPC_URL: "http://127.0.0.1:8545",
                VITE_MONITOR_URL: "http://127.0.0.1:3002",
                VITE_QUOTE_SERVICE_URL: "http://127.0.0.1:3001",
                VITE_DEV_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
            }
        },
        {
            name: "admin-frontend",
            cwd: "./paymaster_monitor/web",
            script: "npm",
            args: "run dev -- --host 127.0.0.1 --port 5174",
            env: {
                VITE_MONITOR_URL: "http://127.0.0.1:3002",
                VITE_ADMIN_TOKEN: "dev_admin_token"
            }
        },
        {
            name: "explorer",
            cwd: "./explorer",
            script: "npm",
            args: "run dev -- --host 127.0.0.1 --port 5175",
            env: {
                VITE_RPC_URL: "http://127.0.0.1:8545"
            }
        }
    ]
};
