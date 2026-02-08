# paymaster_monitor/web/PLAN — Admin Pages + UI Components

## 1) Dashboard (landing)

KPI cards:

- Paymaster deposit (ETH) + runway
- Sponsored ops (24h / total), success rate
- Fees collected (token + ETH equivalent, demo)
- Active sessions (connected clients)
- Bundlers up/down

Charts:

- sponsored ops over time
- fees over time
- denials/reverts by reason
- bundler latency distribution (demo)

## 2) Bundlers page

Table:

- name, url, policy (min priority fee, strictness), uptime, accept/reject counts

Actions:

- spawn new bundler instance (form: name, base type, port, min fee, strict, delay, failure rate)
- stop/restart
- (optional) register external bundler URL (e.g., Infura/Pimlico) to show “permissionless bundling”

## 3) Paymaster page

Sections:

- solvency: EntryPoint deposit, thresholds, alerts
- revenue: fee collected by token, cumulative charts
- config: allowlists, buffers/markups (admin tx)
- recent events: approvals/denials/postOp charges

Error states:

- missing monitor backend env (`DEPLOYMENTS_PATH`) must show exact reason + fix
- auth errors (`ADMIN_TOKEN` mismatch) must be explicit
- missing deployment artifacts/ABIs must point to export step

## 4) Users page

- unique wallets list
- per-wallet stats (ops, volume, success, denials)
- drill-down to user’s operations + logs

## 5) Operations page (UserOps)

- list of UserOperations:
  - hash, sender, bundler, status, timestamps
  - txHash if mined
- details drawer:
  - decoded executeBatch
  - paymaster decision result
  - related logs

## 6) Logs explorer (mandatory)

Filters:

- service
- log level
- time range
- contains text
- userOpHash / txHash / sender / quoteId

UI:

- table list + JSON detail drawer
- live tail mode (SSE)
- “pin filters” and shareable URLs (nice-to-have)

## 7) UI framework choices (design space)

Option A: Tailwind + Radix UI + Recharts  
Option B: MUI (fast admin scaffolding, less “macOS-like”)  
Option C: custom CSS + small component set

Recommendation: Tailwind + Radix for control + macOS feel.

UI guardrail:

- no non-functional desktop controls (close/minimize/zoom) in browser titlebars
