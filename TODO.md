# TODO — Cross-Component Checklist

This is a backlog. Each component folder also has its own `TODO.md`.

## Global

- [x] Lock assumptions (chain runner, token pair, fee model)
- [x] Lock Fuji deployment details (RPC, faucet, explorer, EntryPoint v0.7)
- [x] Lock bundler engine choice: MetaMask-inspired v0.7 engine in `bundler/`
- [ ] Decide how contracts/artifacts are shared across folders
- [x] Define a single “ports & env vars” table of truth (`docs/PORTS_AND_ENV.md`)
- [x] Define log schema + correlation IDs used everywhere (`docs/LOG_SCHEMA.md`)
- [x] Add VS Code `launch.json` run configs (local dev)
- [x] Add VSCode launch config (`.vscode/launch.json`)
- [x] Add one-command local startup/teardown scripts (`scripts/dev-up.sh`, `scripts/dev-down.sh`)
- [x] Align VSCode launch profiles with auto startup (`local: up/down`) and e2e entries
- [x] Add automated soak runner for repeated gasless swaps + artifact capture (`scripts/soak-gasless.sh`)
- [x] Add synthetic analyzer test for soak pass/fail thresholds (`scripts/soak-analyze.test.mjs`)
- [x] Add explicit paymaster sponsorship economics naming in soak reports
- [x] Add manual soak review task in VSCode (`report: latest soak results (manual review)`)
- [x] Implement EIP-7702 Support (Delegation of EOAs to Smart Accounts)

## `paymaster/` (on-chain)

- [x] Choose dev framework (Hardhat vs Foundry) and lock it (**Foundry**)
- [x] EntryPoint integration (v0.7 local deploy + Fuji override)
- [x] SmartAccount + Factory with `executeBatch()` (AA `SimpleAccount` sample)
- [x] Paymaster (fully on-chain policy) + events for analytics (`GaslessSwapPaymaster`)
- [x] Demo DEX (router/pool) + quoting usable by paymaster (`DemoPool`, `DemoRouter`)
- [x] Deployment scripts + exported artifacts (`deployments/*/addresses.json`, `deployments/*/abis/*.json`)

## `bundler1/`

- [x] Full bundler JSON-RPC via shared engine (`bundler/`)
- [x] `simulateValidation` flow against EntryPoint (EntryPointSimulations)
- [x] Submit `handleOps` using bundler EOA
- [x] Structured logs + push to monitor
- [ ] Add bundler1 instance start script/docs

## `bundler2/`

- [x] Variant fee policy + different rejection modes (config)
- [x] Additional delay/failure toggles to demo retry UX (config)
- [x] Structured logs + push to monitor

## `quote_service/`

- [x] Quote endpoint (tokenIn/out/amountIn/slippage/sender)
- [x] Quote expiry/TTL and deterministic routing (demo)
- [x] Return router calldata + recommended minOut/deadline
- [x] Structured logs + optional push to monitor

## `web/` (user app)

- [x] Dark macOS-like UI shell + stepper
- [x] Amount entry + quote fetch + countdown (fixed pair from deployments)
- [ ] Token selector (multi-pair UI)
- [x] Build UserOperation (initCode, callData, gas fields)
- [x] Sign UserOp and submit to selected bundler
- [x] Dev wallet mode for automation (`VITE_DEV_PRIVATE_KEY`)
- [x] Synthetic E2E: Playwright happy-path gasless swap
- [x] Batch soak test harness for repeated gasless swaps + failure thresholding
- [x] Failure fallbacks: quote rebuild, automatic bundler failover, revert decoding (offer “pay gas yourself” only on failure)
- [x] Remove non-functional titlebar window controls
- [x] Paid fallback execution: user-paid swap path (EOA tx on fallback)
- [x] Synthetic E2E: paid fallback path (gasless denial -> user-paid success)
- [x] Soak profile: paid fallback regression (`SOAK_PROFILE=paid-fallback`)

## `paymaster_monitor/` (admin + monitoring)

- [x] Backend: paymaster status endpoints (deposit, balances, config)
- [x] Backend: bundler registry + spawn/stop bundlers (demo-only)
- [x] Backend: logs ingestion + query + live tail
- [x] Backend: persist logs to NDJSON files (no DB) + rehydrate on restart
- [x] Backend: metrics aggregation (sessions + basic ops/fees/gas)
- [x] Backend: metrics aggregation (per-user) + `GET /api/admin/users`
- [x] Backend: robust paymaster status decoding for mixed numeric return types
- [ ] Backend: failure reasons aggregation (quotes/bundler/paymaster/on-chain)
- [x] Backend: paid fallback telemetry counters in summary metrics (`paidFallback.attempted/succeeded/failed`)
- [x] Admin UI: dashboard (basic KPIs)
- [x] Admin UI: dashboard charts (timeseries)
- [x] Admin UI: bundler management page (configs)
- [x] Admin UI: paymaster page (solvency + revenue)
- [x] Admin UI: users page (wallet metrics)
- [x] Admin UI: operations page (UserOps list)
- [x] Admin UI: logs explorer (mandatory)
- [x] Admin UI: remove non-functional titlebar window controls

## explorer/ (new app)

- [x] Project setup (Vite + React + Tailwind)
- [x] Connect to local blockchain node (RPC)
- [x] Dashboard: Latest Blocks & Transactions feed
- [x] View Block details (transactions list)
- [x] View Transaction details (logs/events)
- [x] View Address details (balance + history)
- [x] Global Search (Block/Tx/Address)
- [x] UI/UX Design: Professional & Modern

