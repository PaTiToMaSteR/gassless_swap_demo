# MetaMask Research Notes (for this demo)

Goal: keep this demo **credible to MetaMask reviewers** by aligning terminology, API shapes, and UX failure modes with MetaMask’s own work—without needing to reuse their internal code.

This document is intentionally “design + pointers”, not implementation.

## 1) `@metamask/test-bundler` (key finding)

### What it is

`@metamask/test-bundler` is a small, pragmatic ERC‑4337 bundler used by MetaMask for **E2E client testing**. It provides:

- a JSON‑RPC bundler endpoint (`eth_sendUserOperation`, receipts, etc.)
- a mempool and a simple bundling loop
- a config-driven runtime (ideal for our “multiple bundlers with different fee policies” demo)

References:

- NPM: `https://www.npmjs.com/package/@metamask/test-bundler`
- GitHub: `https://github.com/MetaMask/test-bundler`

### Versioning constraint (important for us)

- NPM “latest” is currently **`1.0.0`**.
- It depends on `@account-abstraction/contracts@^0.6.0`, i.e. **EntryPoint v0.6**, not v0.7.

Our target is **EntryPoint v0.7** (Fuji), so the plan is to:

1) keep the **JSON‑RPC surface + config shape** MetaMask-shaped  
2) use AA contracts **`0.7.x`** and v0.7 packing  
3) use the v0.7 **EntryPointSimulations** approach for simulation on Fuji (no trace)

In this repo we implement the bundler engine in `bundler/` (MetaMask-inspired) instead of importing the published package directly.

Where this is captured:

- `bundler/PLAN.md`
- `bundler1/PLAN.md`
- `bundler2/PLAN.md`

## 2) MetaMask repos/patterns we mirror (inspiration)

### 2.1 Swaps: quotes, routing, and error taxonomy

Repo: MetaMask `swaps-controller`

What we take from it:

- “quote + TTL” as a first-class object (expiry and rebuild are normal)
- clearly surfaced failure reasons (quote expired, simulation failed, on-chain revert)
- routing/pricing separation from execution (quote_service produces route/calldata; execution happens on-chain)

Where this shows up:

- `quote_service/PLAN.md`
- `web/PLAN.md` (expiry + retries)

### 2.2 Smart transactions: simulation-first thinking

Repo: MetaMask `smart-transactions-controller`

What we take:

- treat simulation/estimation as a policy gate (avoid sending ops likely to revert)
- track “reasons” for failure in a structured way (admin analytics)

Where this shows up:

- `bundler1/PLAN.md` (strict simulation gate)
- `paymaster_monitor/PLAN.md` (reason breakdown charts)

### 2.3 Delegation Toolkit / “agentic execution” narrative (optional)

Repos:

- MetaMask `delegation-framework`
- MetaMask `hello-gator`

What we take (mostly storytelling, not required to implement):

- articulate why a user wants a “delegated”/abstracted execution flow
- keep the user mental model: “I sign once; the system does the rest safely”

We can cite this as design inspiration in the presentation, but it’s not required to ship the demo.

### 2.4 AA wallet integrations (narrative)

Repo: `snap-account-abstraction-keyring` (and related AA experiments)

What we take:

- be explicit about account model (EOA owner → Smart Account)
- show the exact UserOp shape and where the signature lives

Where this shows up:

- `web/PLAN.md` (UserOp build/sign)

## 3) How we “use MetaMask libs” pragmatically

Hard constraints:

- Frontend uses `ethers.js` (your requirement).
- Bundler should be MetaMask‑shaped (API surface, config knobs, UX failure modes).

Pragmatic additions (only where it helps clarity/credibility):

- Use `@metamask/sdk` (or the most current MetaMask SDK package) for wallet connect in `web/`.
- Use MetaMask’s JSON-RPC helpers (`@metamask/rpc-errors`, `json-rpc-engine` style middleware) in bundler/monitor where helpful.

We’ll keep dependencies minimal until we begin implementation to avoid bloat.

## 4) Avalanche Fuji specifics that affect MetaMask-shaped UX

- Fuji public RPC does **not** expose `debug_traceCall`, so bundlers must avoid trace-based checks.
- Fuji does support `eth_call` (and appears to accept state overrides), so we can still do **v0.7 simulations** via `EntryPointSimulations` patterns.

Where this is captured:

- `bundler1/PLAN.md` (Fuji constraints)
