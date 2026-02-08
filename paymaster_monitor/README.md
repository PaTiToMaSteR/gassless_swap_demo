# paymaster_monitor/ — Admin + Monitoring (Backend + Admin Web)

This component is the “operations console” for the demo.

It includes:

- `server/` — backend APIs + log ingestion + metrics aggregation + bundler registry + (demo) bundler spawning
- `web/` — admin dashboard UI (dark theme) with charts, tables, and a mandatory log explorer
- paymaster page UX with explicit troubleshooting for backend misconfiguration (`DEPLOYMENTS_PATH`), auth issues, and missing ABI artifacts

Why it exists:

- Paymaster needs solvency monitoring (ETH deposit runway)
- We need an admin UI to explain the business side: costs, revenues, fees, users, reliability
- We need a single place to browse logs from all services

See `PLAN.md` for the full design.

## Runtime config (planned)

Backend (`paymaster_monitor/server`):

- `HOST` — default `127.0.0.1`
- `PORT` — default `3002`
- `ADMIN_TOKEN` — default `dev_admin_token`
- `RPC_URL` — default Fuji public RPC
- `DEPLOYMENTS_PATH` — path to `paymaster/deployments/<network>/addresses.json`
- `DATA_DIR` — defaults to OS temp dir
- logs are persisted under `DATA_DIR/logs/YYYY-MM-DD.ndjson` (NDJSON)
- `LOG_RETENTION_MAX` — in-memory log ring buffer size
- `BUNDLER_PORT_RANGE` — e.g. `3100-3199` for spawned bundlers
- `BUNDLER_PRIVATE_KEY` — forwarded to spawned bundlers

Admin web (`paymaster_monitor/web`):

- `VITE_MONITOR_URL` — e.g. `http://127.0.0.1:3002`
- `VITE_ADMIN_TOKEN` — optional default admin token for local demos
