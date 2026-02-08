# web/PLAN — Screens, Flows, and Contracts Wiring

## 1) Core Screens

### A) Swap (primary)

Inputs:

- tokenIn, tokenOut
- amountIn
- slippage
- bundler selection (dropdown from registry)

Outputs:

- quoted amountOut (gross)
- protocol fee (tokenOut)
- minOut (net)
- quote expiry countdown
- “Gasless Swap” button

States (stepper):

1. Quote requested
2. Quote received
3. Building UserOperation
4. Signature requested (wallet)
5. Submitted to bundler
6. Included on-chain
7. Swap success / failed (with reason)

### B) Activity

- recent swap attempts (local + from monitor)
- status chips (Quoted / Sponsored / Bundling / Confirmed / Failed)
- click into details → show UserOp JSON and decoded executeBatch

### C) Settings (demo knobs)

- choose bundler: bundler1 vs bundler2
- toggles (if we include): “simulate slow bundler”, “force paymaster denial”

## 2) UX for failure handling (must match docs)

Mapping to `docs/Failure handling & UX fallbacks.png`:

- Quote expired:
  - **before signature**: auto “Rebuild quote” (keeps inputs) and continue
  - **after signature**: fail the attempt and offer “Rebuild quote + retry” (requires a new signature)
- Paymaster denies:
  - show structured reason
  - offer actions: reduce size, switch route, switch bundler
  - offer fallback: “Pay gas yourself” (off by default; only shown on failure)
- On-chain revert:
  - show decoded revert if possible
  - suggest reduce size / adjust slippage
  - rebuild quote
- Bundler rejects/slow:
  - **automatic bundler failover** (no extra signature)
  - resend the same signed UserOp to the next available bundler
  - poll for inclusion directly on-chain (EntryPoint events) so we’re not tied to a single bundler’s mempool

## 3) How the web app builds a UserOperation

Minimal approach for the demo:

- Use a canonical SimpleAccount-like smart account
- callData = `executeBatch(targets[], values[], calldatas[])`
- include:
  1. approve/permit for tokenIn (if needed)
  2. router swap calldata
  3. fee transfer calldata (tokenOut → paymaster)

User signs UserOp (standard ERC-4337 signing flow):

- compute userOpHash via EntryPoint
- `signMessage` (or typed data if we prefer; decided later)

**Single-signature requirement (locked):**

- we only request **one signature** for the default gasless flow
- failover/retries must not require re-signing unless the quote/deadline changes (e.g. quote expiry)

Implementation note:

- during gas estimation, bundlers may run `simulateValidation`, which executes the account’s `validateUserOp()` on-chain
- before the user signs, the app uses a **non-reverting dummy signature** (valid `v` + low `s`) so estimation does not fail with ECDSA revert
- because the paymaster is **fully on-chain** and checks `feeAmount >= requiredFee(maxCost)` from the UserOp callData, the app must include a
  **non-zero fee even for the first** `eth_estimateUserOperationGas` call:
  - pick a conservative gas guess
  - compute `feeAmount` from paymaster policy (`gasBufferBps`, `fixedMarkupWei`) and UserOp `maxFeePerGas`
  - estimate gas via bundler(s)
  - recompute/refine fee and gas (still **before** asking for the user signature)

### EntryPoint v0.7 note (locked)

This demo targets **EntryPoint v0.7** on Fuji, so the UserOperation we build must follow the v0.7 RPC shape (unpacked) and then be packed by the bundler into a `PackedUserOperation`:

- account creation is represented as `factory` + `factoryData` (bundler packs to `initCode`)
- paymaster sponsorship is represented as `paymaster` + gas limits + `paymasterData` (bundler packs to `paymasterAndData`)

We will keep the web app aligned with MetaMask’s `eth_sendUserOperation` request shape so swapping bundlers is trivial.

## 4) Bundler marketplace UX

User can choose a bundler:

- show bundler name, fee policy (min priority fee, “strictness”), uptime
- “recommended bundler” badge
- if the chosen bundler fails, the UI automatically switches to another bundler and continues

Bundler list source options:

1) **Off-chain registry** (recommended for demo): `paymaster_monitor/server` provides list.
2) On-chain registry contract: more “web3”, but stores URLs on-chain (awkward).

## 5) Visual design system (dark macOS-like)

We’ll implement a tiny set of design tokens:

- background layers (base / panel / elevated)
- borders and separators
- typography scale
- accent color (single)
- status colors for stepper + logs levels
- web-first titlebar semantics (no non-functional desktop window buttons)

## 6) Open decisions

- Token pair shown in demo (recommended: stable → WAVAX so fee vs gas is intuitive)
- How to present fee (spread vs explicit line item)

## 7) Dev-only automation wallet (synthetic tests)

To enable reliable headless browser automation (without a MetaMask extension), the app supports an optional **dev wallet** mode:

- `VITE_DEV_PRIVATE_KEY` — when set, the app derives the owner EOA from this key and signs UserOp hashes locally.
- This is intended for local demos, synthetic tests, and Playwright automation only (never production).
