# paymaster_monitor/server/ — Admin Backend + Log Hub

Backend for:

- bundler registry + bundler spawning (demo)
- paymaster + chain metrics APIs
- log ingestion + query + live tail
- user/session telemetry ingestion (from `web/`)

The server also exposes **public** endpoints for the user app:

- `GET /api/public/bundlers`

See `PLAN.md` for endpoints and data models.

## Run

```bash
cd paymaster_monitor/server
npm install

# example: local dev (Anvil)
export RPC_URL=http://127.0.0.1:8545
export DEPLOYMENTS_PATH=../../paymaster/deployments/local/addresses.json
export ADMIN_TOKEN=dev_admin_token

npm run dev
```

Default base URL: `http://127.0.0.1:3002`.

### Spawning bundlers

Bundler spawn is **demo-only** and starts OS processes (no Docker).

Prereqs:

1) Build the shared bundler engine:

```bash
cd bundler
npm install
npm run build
```

2) Provide a funded bundler EOA key:

```bash
export BUNDLER_PRIVATE_KEY=0x...
```

The monitor backend will forward `BUNDLER_PRIVATE_KEY` to spawned bundlers.

## Endpoints (implemented)

Public:

- `GET /api/public/health`
- `GET /api/public/bundlers`
- `GET /api/public/deployments` (requires `DEPLOYMENTS_PATH`)

Admin (requires `Authorization: Bearer $ADMIN_TOKEN`):

- `GET /api/admin/bundlers`
- `POST /api/admin/bundlers/spawn`
- `POST /api/admin/bundlers/register`
- `POST /api/admin/bundlers/:id/stop`
- `POST /api/admin/bundlers/:id/unregister`
- `GET /api/admin/paymaster/status`
- `GET /api/admin/metrics/summary`
- `GET /api/admin/metrics/timeseries`
- `GET /api/admin/users`
- `GET /api/admin/userops`

### Paymaster status type compatibility

`GET /api/admin/paymaster/status` now coerces numeric fields defensively across multiple runtime shapes:

- `ethers` `BigNumber` objects
- native `bigint`
- decimal/hex strings
- plain numbers

This prevents failures like `minDelayBetweenOpsSec.toNumber is not a function` when provider/library return types vary.

Logs + telemetry:

- `POST /api/logs/ingest`
- `GET /api/logs`
- `GET /api/logs/stream` (SSE)
- `POST /api/telemetry/session`
- `POST /api/telemetry/event` (`paid_fallback_attempt|paid_fallback_success|paid_fallback_failure`)

`GET /api/admin/metrics/summary` now includes:

- `paidFallback.attempted`
- `paidFallback.succeeded`
- `paidFallback.failed`

## Log persistence (no DB)

Logs are persisted by this server as **NDJSON** (one JSON object per line):

- `DATA_DIR/logs/YYYY-MM-DD.ndjson`

The in-memory ring buffer (used by `GET /api/logs`) is **rehydrated on startup** from the most recent NDJSON files.

## On-chain event indexing (no DB)

If `DEPLOYMENTS_PATH` is configured (and `INDEXER_ENABLED=true`), the server indexes:

- EntryPoint `UserOperationEvent`
- Paymaster `PostOpHandled`

Persisted as NDJSON:

- `DATA_DIR/chain/entrypoint_userops/YYYY-MM-DD.ndjson`
- `DATA_DIR/chain/paymaster_postops/YYYY-MM-DD.ndjson`

## Runtime config

- `HOST` — default `127.0.0.1`
- `PORT` — default `3002`
- `ADMIN_TOKEN` — default `dev_admin_token`
- `RPC_URL` — default Fuji public RPC
- `DEPLOYMENTS_PATH` — path to `paymaster/deployments/<network>/addresses.json` (enables paymaster status + entrypoint address for spawns)
- `DATA_DIR` — default OS temp dir (`gasless-swap-monitor`)
- `LOG_RETENTION_MAX` — default `5000` (in-memory ring buffer)
- `INDEXER_ENABLED` — default `true` when `DEPLOYMENTS_PATH` is set (indexes on-chain events)
- `INDEXER_POLL_INTERVAL_SEC` — default `5`
- `INDEXER_LOOKBACK_BLOCKS` — default `5000` (used when no checkpoint exists)
- `INDEXER_MAX_BLOCK_RANGE` — default `2000`
- `CHAIN_EVENT_RETENTION_MAX` — default `5000`
- `HEALTHCHECK_INTERVAL_SEC` — default `5`
- `BUNDLER_PORT_RANGE` — default `3100-3199`
- `BUNDLER_ENGINE_CMD` — optional override for spawning (used by tests)
- `BUNDLER_PRIVATE_KEY` — forwarded to spawned bundlers
