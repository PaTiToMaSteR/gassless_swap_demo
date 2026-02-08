# paymaster_monitor/TODO

- [ ] Lock metrics list + admin pages (MVP vs nice-to-have)
- [x] Define bundler registry schema
- [x] Define spawn/stop API + instance lifecycle
- [x] Define log ingestion schema + query filters + SSE stream
- [x] Decide storage (NDJSON logs in `DATA_DIR` + in-memory caches)
- [x] Define public endpoints used by `web/`
- [x] Surface actionable paymaster status dependency errors in admin UI
- [x] Harden paymaster status backend numeric decoding (`BigNumber`/`bigint`/`string`)
- [x] Keep admin titlebar web-native (no fake window controls)
