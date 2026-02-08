# Ports & Env Vars (Single Source of Truth)

This doc is the canonical reference for **default ports**, **URLs**, and **env vars** across all services.

## Networks

- **Local dev**: Anvil `http://127.0.0.1:8545` (chainId `31337`)
- **Target demo**: Avalanche Fuji C‑Chain `https://api.avax-test.network/ext/bc/C/rpc` (chainId `43113`)
- **EntryPoint v0.7 (Fuji)**: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

## Default ports

| Component | URL | Port | Notes |
| --- | --- | --- | --- |
| User app | `http://127.0.0.1:5173` | 5173 | `web/` (Vite) |
| Admin app | `http://127.0.0.1:5174` | 5174 | `paymaster_monitor/web/` (Vite) |
| Quote service | `http://127.0.0.1:3001` | 3001 | `quote_service/` (Node) |
| Monitor backend | `http://127.0.0.1:3002` | 3002 | `paymaster_monitor/server/` (Node) |
| Bundler #1 | `http://127.0.0.1:3003/rpc` | 3003 | `bundler/` engine + `bundler1/` config |
| Bundler #2 | `http://127.0.0.1:3004/rpc` | 3004 | `bundler/` engine + `bundler2/` config |
| Explorer app | `http://127.0.0.1:5175` | 5175 | `explorer/` (Vite) |


## Environment variables by component

### `paymaster/` (Foundry)

Required:

- `DEPLOYER_PRIVATE_KEY` — used by `forge script` to deploy (local or Fuji)

Optional:

- `ENTRYPOINT_ADDRESS` — override EntryPoint address (use Fuji v0.7 when deploying to Fuji)
- `PAYMASTER_GAS_BUFFER_BPS` — default `500`
- `PAYMASTER_FIXED_MARKUP_WEI` — default `0`
- `PAYMASTER_MIN_DEPOSIT_WEI` — default `0`
- `PAYMASTER_MIN_DELAY_SEC` — default `0`
- `PAYMASTER_DEPOSIT_WEI` — default `10 ether`
- `SEED_USDC` — liquidity seed, default `1_000_000e6`
- `SEED_WAVAX` — liquidity seed, default `1_000 ether`

### `bundler/` (shared engine)

Required (one of):

- `BUNDLER_PRIVATE_KEY` — EOA used to submit `EntryPoint.handleOps`, OR
- `config.mnemonic` — path to a mnemonic file (used if `BUNDLER_PRIVATE_KEY` is not set)

Config JSON fields (see `bundler1/bundler.config.example.json`):

- `network` (RPC URL)
- `entryPoint` (address)
- `port` (string)
- `beneficiary` (address; if `0x0`, engine uses bundler wallet address)
- `minBalance` (wei string)
- `autoBundleInterval` (seconds)
- `autoBundleMempoolSize` (count)
- `maxBundleGas` (number)
- `unsafe` (boolean)
- `policy.*` (fee floors, strict mode, demo toggles)
- `observability.*` (optional)

### `quote_service/` (Node)

Implemented:

- `HOST` — default `127.0.0.1`
- `PORT` — default `3001`
- `RPC_URL` — Fuji public RPC or Anvil
- `DEPLOYMENTS_PATH` — path to `paymaster/deployments/<network>/addresses.json`
- `QUOTE_TTL_SEC` — quote expiry (default `60`)
- `LOG_INGEST_URL` — optional: `paymaster_monitor/server` log ingest endpoint
- `DATA_DIR` — defaults to OS temp dir

### `paymaster_monitor/server/` (Node)

Implemented:

- `HOST` — default `127.0.0.1`
- `PORT` — default `3002`
- `ADMIN_TOKEN` — bearer token for admin endpoints (default `dev_admin_token`)
- `RPC_URL` — used for on-chain reads (Fuji or Anvil)
- `DEPLOYMENTS_PATH` — path to `paymaster/deployments/<network>/addresses.json`
- `DATA_DIR` — where spawned bundler configs are written (default OS temp dir)
- Logs are also persisted under `DATA_DIR/logs/YYYY-MM-DD.ndjson` (NDJSON)
- `LOG_RETENTION_MAX` — in-memory log ring buffer size (default `5000`)
- `INDEXER_ENABLED` — enable on-chain indexer (default `true` if `DEPLOYMENTS_PATH` set)
- `INDEXER_POLL_INTERVAL_SEC` — default `5`
- `INDEXER_LOOKBACK_BLOCKS` — default `5000` (used when no checkpoint exists)
- `INDEXER_MAX_BLOCK_RANGE` — default `2000`
- `CHAIN_EVENT_RETENTION_MAX` — default `5000`
- `HEALTHCHECK_INTERVAL_SEC` — bundler ping interval (default `5`)
- `BUNDLER_ENGINE_CMD` — override spawn command (mainly for tests)
- `BUNDLER_PORT_RANGE` — e.g. `3100-3199` for spawned instances
- `BUNDLER_PRIVATE_KEY` — forwarded to spawned bundlers

### `web/` (user app, Vite)

Implemented (prefixed for Vite):

- `VITE_RPC_URL`
- `VITE_QUOTE_SERVICE_URL`
- `VITE_MONITOR_URL` (for bundler list + telemetry)
- `VITE_DEV_PRIVATE_KEY` (dev-only; enables “Dev Wallet” mode for automation)

### `paymaster_monitor/web/` (admin app, Vite)

Implemented:

- `VITE_MONITOR_URL`
- `VITE_ADMIN_TOKEN` (demo-only convenience; do not use in real deployments)
