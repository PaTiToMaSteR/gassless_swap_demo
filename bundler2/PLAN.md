# bundler2/PLAN — Fast Bundler Policies

## 1) Objectives

- Run a **full ERC‑4337 bundler** (same engine as bundler1) but with “fast/lenient” policies.
- Provide a second bundler personality to simulate a “bundler marketplace”.
- Enable demos of:
  - bundler switching
  - handling rejections and intermittent issues

## 2) Bundler engine + config

Bundler2 uses the same shared engine as bundler1 (`bundler/`) but is configured via `bundler.config.json`.

Admin can spawn multiple bundler2 instances by generating variant config JSON files (different fee floors / strictness / latency).

## 3) Avalanche Fuji constraints

Same network target and RPC limitations as bundler1:

- chain id `43113` (Fuji)
- public RPC does not expose `debug_traceCall`

Bundler2 should default to settings that work with public RPC (i.e., avoid trace-required safety checks).

## 4) “Fast” policy examples

- Optional validation simulation (configurable):
  - v0.7: use `EntryPointSimulations` (preferred) or `eth_call` + state override
- Lower min priority fee
- Submits immediately (no batching delay)
- Can be configured to occasionally reject or delay (demo toggles)

## 5) Admin-controlled behaviors

Admin panel can spawn bundler2 instances with:

- different min fees
- different “strictness” presets
- different artificial delay / failure rates (for UX demos)

## 6) Observability

Same structured logs schema as bundler1 so admin can compare KPIs.

## 7) RPC compatibility

Bundler2 must be wire-compatible with bundler1:

- same JSON-RPC method names
- same response shapes (especially receipts)

If we add demo-only toggles, they should be exposed via:

- environment variables at process start (spawned by admin), and/or
- an admin-only HTTP endpoint (optional; documented if we add it)

## 8) JSON-RPC methods

Bundler2 implements the same required/optional methods as bundler1 (see `bundler1/PLAN.md`), including:

- `eth_supportedEntryPoints`
- `eth_sendUserOperation`
- `eth_estimateUserOperationGas`
- `eth_getUserOperationReceipt`
- `eth_getUserOperationByHash`
