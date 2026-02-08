# paymaster_monitor/PLAN — Admin + Monitoring Design

## 1) Roles

### 1.1 Monitor backend responsibilities

- **Bundler registry** (list available bundlers for the user app)
- **Spawn/stop bundlers** with custom fee policies (demo requirement)
- **Index on-chain events** (paymaster + entrypoint + swap router) for metrics
- **Ingest backend logs** and expose query APIs
- **Aggregate metrics** for admin dashboards
- Provide **public endpoints** used by `web/` (user app):
  - list bundlers + their fee metadata
  - (optional) system status / degraded mode

### 1.2 Admin web responsibilities

Mandatory pages:

- Dashboard (KPIs + charts)
- Bundlers (spawn/config/stop + health + KPIs)
- Paymaster (deposit runway + fees + config)
- Users (wallet stats, activity)
- Operations (UserOp table, statuses)
- Logs explorer (filterable, live tail)

## 2) Bundler deployment (no Docker)

### 2.1 Design space

**Option A (recommended demo): spawn OS processes**

- backend uses `child_process.spawn` to start additional bundler instances
- stores instance metadata in-memory and persists snapshots to disk (JSON)
- provides stop/restart operations

Pros: simple, shows “many bundlers” quickly.  
Cons: not production-like orchestration.

**Option B: pm2**

- backend shells out to pm2 to manage processes

Pros: mature process manager.  
Cons: extra dependency, less “self-contained”.

We’ll implement Option A for the demo and document pm2 as alternative.

### 2.2 What “fee config” means for a bundler

Bundlers can’t directly charge users on-chain, but they can:

- enforce minimum `maxPriorityFeePerGas` and `maxFeePerGas`
- enforce extra strictness (simulateValidation)
- change inclusion latency (submit fast vs batch)

So “fee tiers” are represented as:

- min acceptable gas params
- strictness / safety checks
- advertised “expected latency”

Admin UI will spawn bundlers with these knobs.

## 3) Metrics aggregation

### 3.1 Sources of truth

- On-chain events (Paymaster, EntryPoint, Router)
- Backend events/logs (quote_service + bundlers)
- Frontend heartbeats (connected sessions)

### 3.2 Storage options

**Option A: in-memory + periodic snapshots** (fastest demo)  
**Option B: file-based event logs** (NDJSON + JSON aggregates)  
**Option C: Postgres + timeseries** (production)

Demo default: **Option B for logs** (NDJSON persisted by `paymaster_monitor/server`), and **Option A for live metrics** (in-memory caches), with optional JSON snapshots if we want restart continuity.

## 4) Log explorer (mandatory)

### 4.1 Ingestion

Each backend service posts logs:

- `POST /api/logs/ingest`
- structured JSON, includes correlation ids

### 4.2 Query + live tail

- `GET /api/logs` (filters: service, level, time range, contains, userOpHash, sender)
- `GET /api/logs/stream` (SSE) for live tail

Admin UI:

- multi-filter controls
- table list + detail drawer with JSON view
- “jump to related” (from userOpHash → bundler logs → txHash)

## 5) Public endpoints for user webapp

### `GET /api/public/bundlers`

Returns bundler list:

```json
[
  {
    "id": "bundler1",
    "name": "Bundler One (Strict)",
    "rpcUrl": "http://127.0.0.1:3003/rpc",
    "policy": { "minPriorityFeeGwei": 2, "strict": true },
    "status": "UP",
    "lastSeen": 1730000000
  }
]
```

User app uses this to populate “bundler marketplace” UI.

## 5.1 External bundlers (optional)

To reinforce the “permissionless bundler network” story, the admin can optionally **register** an external bundler endpoint (no local process spawn), and it will appear in:

- the user app’s bundler selector
- the admin bundlers table (with health + KPIs if we can query them)

## 6) Security posture (demo)

This is a local demo:

- spawning processes and exposing logs is privileged
- admin backend is not hardened for hostile networks

We’ll still:

- bind admin backend to localhost by default
- require an `ADMIN_TOKEN` for spawn/stop endpoints
