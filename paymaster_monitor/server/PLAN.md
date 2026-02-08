# paymaster_monitor/server/PLAN — APIs, Storage, and Data Model

## 1) API groups

### 1.1 Public (used by user app)

- `GET /api/public/bundlers` — list bundlers + fee metadata
- `GET /api/public/deployments` — contract addresses (and optionally minimal ABIs)
- `GET /api/public/health` — overall system health (for banners)
- (planned) `GET /api/public/status` — degraded mode banners

### 1.2 Admin (protected)

Bundlers:

- `POST /api/admin/bundlers/spawn`
- `POST /api/admin/bundlers/register` — register an existing bundler URL (optional)
- `POST /api/admin/bundlers/:id/stop`
- `POST /api/admin/bundlers/:id/unregister` — remove from registry (optional)
- `GET /api/admin/bundlers`

Paymaster:

- `GET /api/admin/paymaster/status`
- (planned) `GET /api/admin/paymaster/revenue`
- (planned) `POST /api/admin/paymaster/config` — writes on-chain via admin key

Implementation note:

- paymaster status decoding must coerce numeric fields across `BigNumber`/`bigint`/`string`/`number` to avoid runtime type-shape errors from provider/library differences.

Users/Ops:

- `GET /api/admin/users`
- `GET /api/admin/userops` — list indexed user operations (from on-chain events)

Logs:

- `POST /api/logs/ingest`
- `GET /api/logs`
- `GET /api/logs/stream` (SSE)

Telemetry (from user app / admin app):

- `POST /api/telemetry/session` — heartbeat (“users connected”)
- `POST /api/telemetry/event` — app events (`paid_fallback_attempt|paid_fallback_success|paid_fallback_failure`)

Metrics:

- `GET /api/admin/metrics/summary`
- `GET /api/admin/metrics/timeseries` — ops/fees/gas buckets for dashboard charts

## 1.3 Auth (admin endpoints)

For the demo we keep it simple:

- Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`.
- Public endpoints have no auth but are intended for localhost usage.

## 2) Data model (draft)

### 2.1 BundlerInstance

- `id`, `name`, `rpcUrl`, `port`
- `policy`: `minPriorityFeeGwei`, `strict`, `delayMs`, `failureRate`
- `status`: UP/DOWN/STOPPED
- `spawnedAt`, `lastSeen`

### 2.2 PaymasterMetrics

- `depositWei` (EntryPoint balance)
- `ethBalanceWei` (paymaster address balance)
- `sponsoredOpsCount`
- `sponsoredGasTotal`
- `feesByToken` (map)
- `denialsByReason` (map)

### 2.3 UserMetrics

- `ownerAddress` (EOA)
- `smartAccountAddress`
- `opsCount`, `successCount`, `denyCount`, `revertCount`
- `volumeByToken`
- `lastSeen`

### 2.4 LogEvent

Mandatory fields:

- `ts`, `service`, `level`, `msg`
- correlation ids: `requestId` (HTTP), `quoteId`, `userOpHash`, `txHash`, `sender`
- `meta` (JSON)

Example ingest payload:

```json
{
  "ts": 1730000000,
  "service": "bundler1",
  "level": "info",
  "msg": "userOp accepted",
  "requestId": "req_...",
  "userOpHash": "0x...",
  "sender": "0x...",
  "txHash": null,
  "meta": {
    "reasonCode": null,
    "entryPoint": "0x...",
    "paymaster": "0x..."
  }
}
```

## 3) Storage options

MVP (implemented / preferred in this repo):

- in-memory ring buffer for fast log queries (last `LOG_RETENTION_MAX` events)
- **append-only NDJSON log files** persisted by the monitor backend under:
  - `DATA_DIR/logs/YYYY-MM-DD.ndjson`
- on restart, the server **rehydrates** the in-memory ring buffer from the most recent NDJSON files

Notes:

- the monitor backend is the **single writer** to the NDJSON files
- other services should POST logs to `POST /api/logs/ingest` (avoid concurrent writes)
  
If we later need faster historical analytics:

- materialize aggregates to JSON snapshots (files), or
- add lightweight sidecar indexes (files) keyed by `userOpHash`, `sender`, etc.

## 4) Indexing on-chain events

Implemented in this repo as a simple polling indexer (`OnChainIndexer`):

- EntryPoint `UserOperationEvent`
- Paymaster `PostOpHandled`
- Router swap events

This allows metrics without depending on bundlers’ internal logs.

### 4.1 Persistence (file-based, no DB)

Raw chain events are persisted as NDJSON (append-only, one JSON object per line):

- `DATA_DIR/chain/entrypoint_userops/YYYY-MM-DD.ndjson`
- `DATA_DIR/chain/paymaster_postops/YYYY-MM-DD.ndjson`

Indexer checkpoint:

- `DATA_DIR/chain/indexer_state.json`

On server start:

- recent events are reloaded from disk (tail read) to repopulate in-memory analytics

### 4.2 Indexer runtime config (env)

- `INDEXER_ENABLED` — default `true` if `DEPLOYMENTS_PATH` is set
- `INDEXER_POLL_INTERVAL_SEC` — default `5`
- `INDEXER_LOOKBACK_BLOCKS` — default `5000` (only used when no checkpoint exists)
- `INDEXER_MAX_BLOCK_RANGE` — default `2000` (limits `eth_getLogs` range)
- `CHAIN_EVENT_RETENTION_MAX` — default `5000` (in-memory retention and disk rehydrate tail)

### 4.3 UserOps endpoint (shape)

`GET /api/admin/userops?limit=200&sender=0x...&success=true|false`

Response:

```json
{
  "userops": [
    {
      "ts": 1730000000,
      "chainId": 43113,
      "blockNumber": 123,
      "txHash": "0x...",
      "userOpHash": "0x...",
      "sender": "0x...",
      "paymaster": "0x...",
      "bundler": "0x...",
      "nonce": "0",
      "success": true,
      "actualGasCostWei": "123",
      "actualGasUsed": "456",
      "feeAmount": "789",
      "postOpMode": "opSucceeded"
    }
  ]
}
```

### 4.4 Users endpoint (shape)

`GET /api/admin/users`

This endpoint is “UI-facing” and combines:

- telemetry (connected sessions + `owner → sender` mapping when available)
- indexed on-chain UserOps (per-sender totals / success rate / gas + fees)

Response:

```json
{
  "owners": [
    {
      "owner": "0x...",
      "firstSeenMs": 1730000000000,
      "lastSeenMs": 1730000000000,
      "senders": ["0x..."],
      "total": 12,
      "succeeded": 11,
      "failed": 1,
      "lastOpTs": 1730000000,
      "totalActualGasCostWei": "123",
      "totalFeeAmount": "456"
    }
  ],
  "senders": [
    {
      "sender": "0x...",
      "owner": "0x...",
      "firstSeenMs": 1730000000000,
      "lastSeenMs": 1730000000000,
      "total": 12,
      "succeeded": 11,
      "failed": 1,
      "lastOpTs": 1730000000,
      "totalActualGasCostWei": "123",
      "totalFeeAmount": "456"
    }
  ]
}
```

## 5) Spawning bundlers

Spawn strategy:

- maintain a “bundler executable command” template
- pass config via env vars and CLI args
- allocate ports from a configured range

Important: bundler folders are separate (`bundler1/`, `bundler2/`), so “spawn” means:

- start another instance of `bundler2/` with a new port and policy

### 5.0 What “full bundler” means here

Spawned processes should be **real bundler servers** implementing the ERC‑4337 RPC methods (not mocks).

Each bundler folder will:

- own a `bundler.config.json`
- run a chosen bundler engine (see `bundler1/PLAN.md`)

The monitor backend spawns instances by:

1) allocating a port
2) writing a config JSON file
3) starting a new process pointing at that config
4) tracking PID + health + policy metadata

Observability:

- spawned bundlers are configured with `observability.service = <bundler instance id>`
- bundlers ship structured logs to the monitor `POST /api/logs/ingest`
- the monitor only ingests **non-JSON** stdout/stderr lines from spawned bundlers (to avoid duplicate events)

### 5.1 Spawn endpoint (draft)

`POST /api/admin/bundlers/spawn`

Request:

```json
{
  "base": "bundler2",
  "name": "Bundler 2 — cheap fees",
  "policy": {
    "minPriorityFeeGwei": 0.2,
    "strict": false,
    "delayMs": 0,
    "failureRate": 0.05
  }
}
```

Response:

```json
{
  "id": "bundler2_abc123",
  "name": "Bundler 2 — cheap fees",
  "rpcUrl": "http://127.0.0.1:3110/rpc",
  "status": "DOWN",
  "spawned": true
}
```

### 5.1.1 Register endpoint (optional)

`POST /api/admin/bundlers/register`

Use case: include a third-party bundler in the marketplace (without spawning a local process).

Request:

```json
{
  "name": "Infura Bundler (Fuji)",
  "rpcUrl": "https://.../rpc",
  "policy": {
    "strict": true,
    "minPriorityFeeGwei": 1.0
  }
}
```

### 5.2 Log streaming format (SSE)

`GET /api/logs/stream` sends events like:

```
event: log
data: {"ts":...,"service":"bundler1",...}
```
