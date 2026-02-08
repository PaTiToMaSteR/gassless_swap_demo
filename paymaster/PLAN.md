# paymaster/PLAN — Contracts, Invariants, and On-Chain Paymaster Policy

## 0) The Principle

The Paymaster is the **policy enforcement point**. It must be able to decide “sponsor or deny” using only:

- `UserOperation` fields
- on-chain state (pool reserves, paymaster config, deposits)

No off-chain signature is required to approve sponsorship.

## 0.2 Tooling (locked)

We use **Foundry** for contracts + tests:

- `forge` for build/test/deploy scripting
- `anvil` as the local JSON-RPC dev chain

Fuji remains the final deployment target.

## 0.1 Target network (research-backed default)

We will deploy the demo contracts to **Avalanche Fuji (C‑Chain)**:

- chain id: `43113`
- RPC: `https://api.avax-test.network/ext/bc/C/rpc`
- native token: AVAX

ERC‑4337 EntryPoint is already deployed on Fuji (we can choose either version):

- **v0.7** EntryPoint: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

Decision: we will pick one EntryPoint version and keep it consistent across:

- bundlers (configuration + simulations)
- smart account implementation
- paymaster implementation
- frontend UserOp builder

Locked: **v0.7**.

## 1) Contracts (draft set)

### A) EntryPoint (ERC‑4337)

- canonical implementation (EntryPoint **v0.7**)
- we will use `eth-infinitism/account-abstraction@v0.7.0` (source + interfaces) to avoid ABI drift

### B) Smart Account + Factory

Requirements:

- owner = user EOA (for demo simplicity)
- supports `executeBatch(address[] targets, uint256[] values, bytes[] data)`
- emits an event for each batch item (optional) to aid monitoring

Implementation baseline:

- use the AA sample `SimpleAccount` / `SimpleAccountFactory` (already supports `executeBatch(dest[], value[], func[])`)
- no extensions are required for the demo (monitoring uses EntryPoint + Paymaster events)

### C) Demo Router + Pool

Goal: deterministic swaps that can be:

- quoted off-chain by `quote_service/`
- verified on-chain by Paymaster before sponsorship

Recommended: constant-product AMM with single-hop swaps.

Implemented in this repo:

- `DemoPool` — deterministic constant-product pool with `quoteExactIn()` and `swapExactIn()`
- `DemoRouter` — enforces `deadline`, does `transferFrom`, and calls the pool

### D) GaslessSwapPaymaster (name placeholder)

Implements ERC‑4337 paymaster interface:

- `validatePaymasterUserOp(...)`
- `postOp(...)`

The paymaster:

- validates the **shape** of `executeBatch()` callData
- validates router/tokens are allowed
- validates quote TTL via `deadline`
- validates slippage via `minOut`
- enforces **fee >= gas cost buffer**
- enforces basic rate limits/caps (demo)

Implemented in this repo:

- `GaslessSwapPaymaster` — validates an exact 3-step `executeBatch()` shape and enforces fee≥gas-buffer.

## 2) Call Shape Enforcement (executeBatch)

We mirror `docs/Packed execution inside the smart account.png`.

Recommended batch items order (demo):

1) `tokenIn.approve(router, amountIn)` (or Permit2 step)
2) `router.swapExactIn(tokenIn, tokenOut, amountIn, minOutGross, to=smartAccount, deadline)`
3) `tokenOut.transfer(paymaster, feeAmount)` (protocol fee / gas reimbursement)

Notes:

- We can define `minOutGross` and `minOutNet` precisely:
  - `amountOutGross` = router output
  - `feeAmount` deducted
  - user receives `amountOutGross - feeAmount`
  - `minOutNet` is what UI displays to user

Paymaster validation rule:

- computed `amountOutGross` (from pool state) must satisfy:
  - `amountOutGross >= minOutGross`
  - `amountOutGross - feeAmount >= minOutNet` (if we include net in calldata)

We will lock the exact encoding once we pick the API format for quotes.

## 3) Fee Policy (fully on-chain)

We must implement “Fee >= gas cost buffer” (per your diagram).

### 3.1 Gas cost estimate (upper bound)

In ERC‑4337, EntryPoint passes `maxCost` into `validatePaymasterUserOp(...)`.

Implementation uses:

- `requiredFeeWei = maxCost * (1 + gasBufferBps) + fixedMarkupWei`

### 3.2 Fee denomination

Two viable on-chain designs:

**Option A (recommended demo): fee in wrapped native (tokenOut)**

- Make tokenOut = **WAVAX** (or a WAVAX-like token we deploy for Fuji).
- Then fee in tokenOut is directly comparable to gas cost in wei (1 WAVAX = 1 AVAX when unwrapped).
- required fee:
  - `requiredFeeWrappedNative = requiredWei + protocolMarkupWei`

**Option B: fee in arbitrary token**

- Store an on-chain price oracle (fixed for demo) to convert wei → token units.
- More flexible but adds config + potential mismatch.

We can implement both, but Option A keeps the demo crisp.

## 4) Rate limits / Risk checks (on-chain)

We implement a “good enough” set for a demo:

- per-sender minimum interval between sponsored ops
- per-sender max sponsored amount in window (optional)
- global pause switch
- allowlists:
  - router
  - token pairs

## 5) Solvency checks

Paymaster should refuse if:

- EntryPoint deposit < configured threshold
- paymaster is paused

## 6) Events for monitoring & admin analytics

We emit events from Paymaster (and optionally Smart Account) so `paymaster_monitor/` can compute:

- total sponsored operations
- gas sponsored
- fee collected
- failure reasons (denied vs reverted)

Events (draft):

- `PostOpHandled(sender, userOpHash, mode, actualGasCostWei, actualUserOpFeePerGas, feeAmount)`

## 7) Admin controls (on-chain)

Owner-only functions:

- set fee params (buffers, markups)
- set thresholds (min deposit)
- set rate limits (min delay)

Implementation note:

- router + token pair are currently **immutable** constructor params (keeps the demo deterministic).
- policy knobs are set via `GaslessSwapPaymaster.setPolicy(...)`.

Admin UI will call these via `paymaster_monitor/` using an admin key (local demo).

## 8) Alternatives (documented)

Detailed comparison of alternative gasless approaches:
- [ALTERNATIVES.md](file:///Users/prompt/git/consensys_test/docs/ALTERNATIVES.md)
- Meta-transaction approach with trusted forwarder (documented)
- EIP-7702 “temporary code authorization” for EOAs (documented)
