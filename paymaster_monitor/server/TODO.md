# paymaster_monitor/server/TODO

- [x] Lock endpoint list + auth model (ADMIN_TOKEN)
- [x] Implement bundler registry + health checks
- [x] Implement process spawn/stop + port allocation
- [x] Implement on-chain event indexer (EntryPoint + Paymaster) + persist NDJSON
- [x] Implement logs ingest/query/stream
- [x] Persist logs to NDJSON under `DATA_DIR/logs` + rehydrate on restart
- [x] Implement metrics aggregation (in-memory)
- [x] Implement users analytics endpoint (`GET /api/admin/users`)
- [x] Fix paymaster status numeric coercion across `BigNumber`/`bigint`/`string` return types
- [x] Track paid fallback telemetry and expose counters in `GET /api/admin/metrics/summary`
