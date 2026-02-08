# quote_service/ — Quote + Routing (Off-Chain)

Service that returns a **swap quote** and a concrete **route/callData** the Smart Account will execute.

Even with an on-chain paymaster, keeping quotes off-chain is useful to demonstrate:

- routing + pricing layer (per the challenge)
- quote TTL/expiry
- UX retries and quote rebuilding

See `PLAN.md` for the API design and routing model.

## Run

```bash
cd quote_service
npm install

# example: local dev (Anvil)
export RPC_URL=http://127.0.0.1:8545
export DEPLOYMENTS_PATH=../paymaster/deployments/local/addresses.json

npm run dev
```

Default base URL: `http://127.0.0.1:3001`.

## Runtime config

- `HOST` — default `127.0.0.1`
- `PORT` — default `3001`
- `RPC_URL` — Fuji RPC (or local dev RPC)
- `DEPLOYMENTS_PATH` — path to deployments JSON produced by `paymaster/` (or set router/token addresses directly)
- `LOG_INGEST_URL` — `paymaster_monitor/server` log ingestion endpoint (optional but recommended)
- `QUOTE_TTL_SEC` — default `60`
- `DATA_DIR` — defaults to OS temp dir

## Endpoints

- `POST /quote` — returns route/calldata + expiry
- `GET /quote/:quoteId` — returns quote if still valid, else `410`
- `GET /health` — basic health check
- `GET /config` — supported pairs + TTL
