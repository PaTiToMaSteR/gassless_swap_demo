# Log Schema & Correlation IDs

This repo requires a **central logs explorer** in `paymaster_monitor/`.

To make that possible across multiple independent processes (bundlers, quote service, monitor backend), we standardize a simple JSON log envelope.

## Canonical JSON log event

Every service should emit (to stdout and/or to the monitor ingestion API) JSON objects shaped like:

```json
{
  "ts": 1730000000,
  "level": "info",
  "service": "bundler1",
  "msg": "userOp accepted",
  "requestId": "req_...",
  "sessionId": "sess_...",
  "quoteId": "quote_...",
  "userOpHash": "0x...",
  "sender": "0x...",
  "owner": "0x...",
  "txHash": "0x...",
  "chainId": 43113,
  "meta": {}
}
```

Notes:

- `meta` is always an object (service-specific extra fields).
- Any field may be omitted if unknown, but `ts/level/service/msg` are required.

## Correlation ID rules

Use these IDs consistently to enable “jump to related logs” in the admin UI:

- `requestId`: per inbound HTTP request (monitor backend); accept `x-request-id` if provided, else generate.
- `sessionId`: per browser session (user web + admin web); generate once and keep in `localStorage`.
- `quoteId`: assigned by `quote_service` and echoed by `web/` and bundlers where possible.
- `userOpHash`: computed before sending to bundler (via EntryPoint `getUserOpHash`).
- `txHash`: bundle transaction hash (from bundler once it submits `handleOps`).
- `sender`: smart account address.
- `owner`: EOA owner address (if known client-side).

## Ingestion API (monitor backend)

`POST /api/logs/ingest`

- accepts either a single `LogEvent` or an array of `LogEvent`
- returns `{ ok: true }`

Minimum validation:

- `service` must be a short identifier (e.g. `bundler1`, `quote_service`, `monitor`)
- `level` ∈ `debug|info|warn|error`
- `ts` must be a unix timestamp in seconds (or ms if documented consistently)

## Recommended levels

- `debug`: verbose internals (dev only)
- `info`: expected lifecycle (accepted, submitted, mined)
- `warn`: recoverable issues (quote expired, retry)
- `error`: failures needing attention (handleOps reverted, RPC down)

## Persistence (file-based, no DB)

`paymaster_monitor/server` persists all ingested logs as **NDJSON** (one JSON object per line):

- `paymaster_monitor/server` `DATA_DIR/logs/YYYY-MM-DD.ndjson`

The admin UI queries recent logs from the in-memory ring buffer (rehydrated on server startup from these files).
