# Gasless Swap Demo (ERC-4337) — Multi-Service, No Docker

This repo is a **take‑home demo build** for “Designing a Gasless Swap Experience”.

The goal is to ship a working local demo where a user can **swap tokens with 0 ETH**, by signing a single action (UserOperation) while **gas is sponsored by a Paymaster** and submitted by **Bundlers**. In parallel, we ship an **Admin/Monitor** app to operate the system: paymaster solvency, revenues/fees, bundler configs, user metrics, and backend logs.

## Non‑Negotiables (from you)

- **No Docker** — everything runs as local processes.
- **One top‑level folder per element** (web, bundlers, paymaster, monitor, etc.).
- **Paymaster policy is fully on‑chain** (no off‑chain signatures for sponsorship decisions).
- **Admin panel** with deep stats + **log explorer** is mandatory.

## Repo Structure

- `docs/` — challenge PDF, deck PDF, and diagrams (source of truth for flows)
- `web/` — user-facing swap webapp (React + Vite, dark macOS-like theme, `ethers.js`)
- `quote_service/` — quote + routing service (off‑chain), returns swap route/calldata + expiry
- `bundler1/` — ERC‑4337 bundler simulator #1 (strict)
- `bundler2/` — ERC‑4337 bundler simulator #2 (fast/lenient)
- `paymaster/` — Solidity + local chain tooling (EntryPoint, Smart Account, Paymaster, Router/Pool, Tokens)
- `paymaster_monitor/` — **Admin + Monitoring** (backend + frontend) for paymaster/bundlers/users/logs

## System Overview (at a glance)

1. **User** selects `tokenIn/tokenOut/amount` in `web/`.
2. `web/` calls `quote_service/` for a quote: route, calldata, `deadline`, `minOut`, quote id.
3. `web/` builds an **ERC‑4337 UserOperation** that calls the Smart Account’s `executeBatch()`.
4. `web/` chooses a bundler from the list (served by `paymaster_monitor/`) and sends `eth_sendUserOperation`.
5. Bundler submits `EntryPoint.handleOps()`.
6. **Paymaster validates sponsorship on‑chain** (router/tokens/expiry/slippage/fee>=gas-buffer, limits).
7. Smart Account executes: `approve/permit` → `swap` → `fee transfer`.
8. `paymaster_monitor/` indexes on‑chain events + backend logs and shows metrics in an admin panel.

## Target chain (research-backed default)

We will deploy the on-chain system to **Avalanche Fuji (C‑Chain)** for the demo:

- Chain ID: `43113`
- RPC: `https://api.avax-test.network/ext/bc/C/rpc`
- Native token: AVAX (bundlers need AVAX to submit `handleOps`)
- Explorer: `https://subnets-test.avax.network/c-chain`
- Faucet: `https://faucet.avax.network/` (or Core app: `https://core.app/tools/testnet-faucet/?subnet=c`)
- EntryPoint (ERC‑4337 **v0.7**) is deployed on Fuji at: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

We can still run locally during development, but Fuji is the “demo deployment” target.

Local-first dev chain:

- **Anvil** (Foundry) at `http://127.0.0.1:8545`

## Where the design lives

- Root: `PLAN.md` and `TODO.md`
- Each component: `README.md`, `PLAN.md`, `TODO.md` in its folder
- Cross-cutting docs: `docs/PORTS_AND_ENV.md`, `docs/LOG_SCHEMA.md`

Nothing is “implementation-final” until we agree on the specs in these docs.

## One-command local startup

For local demos on Anvil, use the orchestration scripts:

```bash
./scripts/dev-up.sh
```

What it does:

1) starts Anvil (or reuses local RPC on `127.0.0.1:8545`)
2) deploys contracts and exports ABIs
3) starts monitor backend, quote service, user web, and admin web
4) spawns `bundler1` and `bundler2` through the monitor admin API

Stop all managed processes:

```bash
./scripts/dev-down.sh
```

Logs + pid files are written under `output/local-dev/`.

## VS Code (launch configs)

If you use VS Code, this repo includes convenience run commands in:

- `.vscode/launch.json`

Notes:

- Compounds start processes in parallel; run **Anvil → deploy → export ABIs** first.
- The local configs use Anvil’s default dev key (safe for local only).

## VSCode (Run & Debug)

This repo includes a starter VSCode `launch.json`:

- `.vscode/launch.json`

Suggested local dev flow:

1) Preferred: run `local: up (auto full stack)` (one command).
2) Stop everything with `local: down (auto full stack)`.
3) If you want manual control, run:
   - `local: anvil (chain 31337)`
   - `local: paymaster deploy (anvil)`
   - `local: paymaster export abis`
   - `local: services (monitor + quote + user web)` and `local: admin web dev`
4) Optionally run synthetic browser checks:
   - `test: web e2e gasless swap`
   - `test: web e2e bundler failover`
   - `test: web e2e paid fallback`
   - `test: soak gasless swaps (auto stack)`
   - `test: soak bundler failover (auto stack)`
   - `test: soak paid fallback (auto stack)`
   - `test: soak analyzer (synthetic)`
   - `report: latest soak results (manual review)`

## Automated Soak Testing (batch gasless swaps + logs)

Use the soak runner to execute many gasless swaps automatically, collect monitor artifacts, and enforce thresholds:

```bash
SOAK_OWNER_PRIVATE_KEY=0x... SOAK_ITERATIONS=20 SOAK_PROFILE=swap ./scripts/soak-gasless.sh
```

Profiles:

- `SOAK_PROFILE=swap`
- `SOAK_PROFILE=failover`
- `SOAK_PROFILE=paid-fallback`

What it does:

1) Optionally boots the full local stack (`SOAK_AUTO_UP=1`, default)
2) Runs repeated Playwright gasless swap tests
3) Collects monitor artifacts:
   - `summary.json` (`/api/admin/metrics/summary`)
   - `userops.json` (`/api/admin/userops`)
   - `logs.json` (`/api/logs`) filtered with `since=<run_start_ts>` to avoid historical-log noise
4) Runs analyzer checks and exits non-zero on threshold failures

`summary.json` includes paid fallback telemetry counters:

- `paidFallback.attempted`
- `paidFallback.succeeded`
- `paidFallback.failed`

Artifacts are saved in:

- `output/soak/<timestamp>/`
- per-attempt logs in `output/soak/<timestamp>/attempts/`
- final report in `output/soak/<timestamp>/report.json`

Manual review helper:

```bash
node scripts/soak-report-latest.mjs
```

This prints full-name business metrics:

- Paymaster Sponsorship Revenue
- Paymaster Sponsorship Expense
- Paymaster Sponsorship Net
- Paymaster Sponsorship Margin

Threshold knobs:

- `MAX_RUNNER_FAILURES` (default `0`)
- `MAX_USEROP_FAILURES` (default `0`)
- `MAX_ERROR_LOGS` (default `0`)
- `MIN_SUCCESSFUL_SWAPS` (default `SOAK_ITERATIONS`)
