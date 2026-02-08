# PLAN — Gasless Swap Demo (Spec First)

This file locks the **system-level design**. Each folder has its own `PLAN.md` that drills into details.

## 1) Product UX We’re Demonstrating

**Primary UX:** “one‑click swap” (one signature) for a user with **0 ETH**.

**Failure UX (mandatory):**

- Quote expired → rebuild quote
- Paymaster denies sponsorship → offer “user pays gas” fallback
- On-chain revert → suggest reduce size / change route → rebuild quote
- Bundler rejects/slow → switch bundler (bundler marketplace feel)

## 2) Key Architectural Constraints

### 2.1 Paymaster must be fully on-chain

Sponsorship decisions are enforced by Paymaster code on chain:

- Allowlist router and token pairs
- Quote TTL enforcement via `deadline`
- Slippage guard via `minOut`
- Rate limits / caps (simple on-chain constraints)
- Fee policy:
  - must ensure **fee ≥ estimated gas cost buffer**
  - fee is collected on-chain (for revenue metrics)

No “sponsor service signs paymasterAndData”. `paymasterAndData` may still carry small config knobs (tier id), but not a decision signature.

### 2.2 One folder per element

No monorepo-only “shared package” is required. We can still share via:

- reading ABIs + deployments from `paymaster/` at runtime, or
- generating a small artifacts bundle during deploy (documented in `paymaster/PLAN.md`).

### 2.3 No Docker

All processes are started via local shell commands (per-folder scripts).

## 3) Components (What Each Does)

### `web/` (User app)

- Wallet connect
- Quote request
- Build and sign UserOperation
- Send to chosen bundler
- Display stepper state and retries

### `quote_service/`

- Route selection (demo: deterministic)
- Quote expiry/TTL
- Builds router calldata for the chosen route

### `bundler1/` and `bundler2/`

Minimal ERC‑4337 bundlers that accept UserOps and submit `handleOps`:

- JSON-RPC endpoints (at least `eth_sendUserOperation`, `eth_getUserOperationReceipt`)
- mempool + simple bundling loop
- different fee policies to simulate a “bundler marketplace”

### `paymaster/`

Solidity + local chain:

- EntryPoint
- Smart Account + Factory (supports `executeBatch()`)
- Paymaster (fully on-chain policy)
- Swap Router + Pool (demo DEX)
- ERC20 tokens for demo
- Deploy scripts export addresses/artifacts for other services

### `paymaster_monitor/` (Admin + Monitoring)

Two roles:

1) **Operations backend**: collects logs, tracks bundlers, exposes metrics APIs, spawns bundlers (demo).
2) **Admin UI**: dashboard, bundler management, paymaster solvency, revenue analytics, user analytics, log explorer.

## 4) Ports & URLs (draft)

These are defaults; each component doc lists its own.
For the single table of truth, see `docs/PORTS_AND_ENV.md`.

- Chain RPC (default: **Avalanche Fuji**): `https://api.avax-test.network/ext/bc/C/rpc`
- Chain RPC (dev fallback: local): `http://127.0.0.1:8545`
- User Web: `http://127.0.0.1:5173`
- Quote Service: `http://127.0.0.1:3001`
- Bundler1: `http://127.0.0.1:3003`
- Bundler2: `http://127.0.0.1:3004`
- Paymaster Monitor (backend): `http://127.0.0.1:3002`
- Paymaster Monitor (admin web): `http://127.0.0.1:5174`

## 5) Observability & Admin Requirements

### 5.1 Metrics we must show (Admin)

**Paymaster**

- EntryPoint deposit (ETH)
- ETH “days of runway” estimate (deposit / avg spend rate)
- Sponsored UserOps: count, success rate, gas used
- Fees collected (token amounts) + “gas reimbursed” (ETH) + gross margin (demo)

**Bundlers**

- Active bundlers + fee policies
- accepted/rejected ops
- average inclusion latency
- revenue estimates per bundler (demo-level)

**Users**

- active sessions (connected clients)
- unique wallets (owner EOA + smart account)
- per-wallet volume, success rate, denials

**System**

- quote expiry stats
- top failure reasons
- logs/errors rate
- paid-fallback adoption and outcome rate (`attempted/succeeded/failed`)

### 5.2 Logs explorer (Admin)

Centralized log ingestion:

- each backend pushes structured JSON logs to `paymaster_monitor/server`
- log envelope + correlation rules are defined in `docs/LOG_SCHEMA.md`
- admin UI can filter by `service`, `level`, `requestId`, `userOpHash`, `sender`, `txHash`
- support a “live tail” (SSE/WebSocket)

## 6) Decisions We Still Need to Lock

These will live as explicit “Decision Records” in folder plans:

- Local chain runner: **Anvil** (locked)
- EntryPoint version: **locked to v0.7**
- Bundler engine: **locked to in-repo `bundler/` engine (MetaMask-inspired, v0.7)**
- Fuji RPC strategy: **locked to public RPC** (no `debug_traceCall`; bundlers run in “no-trace/unsafe” mode where needed)
- Demo tokens/pairs: **stable → WAVAX** (locked; makes fee vs gas intuitive)
- Fee model details: **fee in WAVAX/tokenOut with on-chain buffer** (locked)
- Whether to include a lightweight “bundler registry” contract or keep registry off-chain in monitor backend

## 7) Implementation Phasing (when we start coding)

0. Local orchestration: one-command startup/teardown scripts for repeatable demos (`scripts/dev-up.sh`, `scripts/dev-down.sh`).
1. On-chain: deploy EntryPoint + SmartAccount + Paymaster + Demo DEX + tokens.
2. One bundler implementation end-to-end (bundler1), then bundler2 variants.
3. User webapp: quote → sign → send UserOp → status.
4. Admin/monitor backend: metrics + bundler registry + log ingestion.
5. Admin UI: dashboard + logs + bundler management.
6. Synthetic soak harness: batch gasless swaps, collect monitor artifacts, and fail on threshold breaches (`scripts/soak-gasless.sh`, `scripts/soak-analyze.mjs`).
