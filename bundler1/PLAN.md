# bundler1/PLAN — Strict Bundler Policies

## 1) Objectives

- Run a **full ERC‑4337 bundler** (standard JSON‑RPC API + mempool + bundling loop) on EntryPoint **v0.7**.
- Validate UserOps aggressively to reduce failed `handleOps` submissions.
- Make all policy knobs editable via a local `bundler.config.json`.

## 2) Bundler engine

The shared engine is implemented in `bundler/` (MetaMask-inspired, v0.7).

This folder (`bundler1/`) defines the **strict policy defaults** via config.

## 3) Avalanche Fuji constraints (research)

Target network for the deployed demo is **Avalanche Fuji C‑Chain**:

- chain id: `43113`
- native token: AVAX
- public RPC: `https://api.avax-test.network/ext/bc/C/rpc`

Important for bundlers:

- The public Fuji RPC **does not support** `debug_traceCall` (so bundler “safe mode” features that require trace may need to be disabled), but
- it **does** accept `eth_call` with the **state override** parameter (useful for ERC‑4337 simulations).

Practical implication:

- bundler1 can be strict about schema, fee floor, TTL windows, and simulations that rely on `eth_call`,
- but we may need to disable trace-based checks unless we use a paid RPC that enables debug methods.

## 4) Strict policy examples

- Always run validation simulation before accepting into mempool:
  - v0.7: use `EntryPointSimulations` (preferred) or `eth_call` + state override
- Require `validUntil - now` ≥ minimum safety window
- Require `maxPriorityFeePerGas` ≥ configured minimum
- Reject if `callGasLimit` is too low vs estimate
- Reject if paymaster deposit is below threshold (preflight read)

## 4.1 JSON config file

Bundler1 reads a single JSON file at startup:

- `bundler.config.json`

We’ll standardize a schema that includes:

- network RPC URL (`network`)
- EntryPoint address (`entryPoint`)
- server port (`port`)
- bundler EOA beneficiary (`beneficiary`, must be non-zero on v0.7; `0x0` means “use bundler wallet”)
- optional mnemonic file (`mnemonic`) or `BUNDLER_PRIVATE_KEY` env var
- bundling loop (`autoBundleInterval`, `autoBundleMempoolSize`, `maxBundleGas`)
- admission control (`policy.*`)
- safety toggles (`unsafe`)
- observability (`observability.*`)

Admin (`paymaster_monitor/server`) can spawn new bundlers by generating a new config file and starting a new process.

### 4.1.1 Example `bundler.config.json` (draft)

```json
{
  "network": "https://api.avax-test.network/ext/bc/C/rpc",
  "entryPoint": "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  "port": "3003",
  "beneficiary": "0x0000000000000000000000000000000000000000",
  "minBalance": "0",
  "mnemonic": "./bundler.mnemonic.txt",
  "autoBundleInterval": 5,
  "autoBundleMempoolSize": 1,
  "maxBundleGas": 5000000,
  "unsafe": true,
  "policy": { "strict": true, "minPriorityFeeGwei": 2, "minMaxFeeGwei": 25, "minValidUntilSeconds": 30 },
  "observability": { "monitorUrl": "http://127.0.0.1:3002", "service": "bundler1" }
}
```

Notes:

- Prefer `BUNDLER_PRIVATE_KEY` env var to keep secrets out of JSON.
- For interactive demos, keep `autoBundleMempoolSize: 1` so a single accepted UserOp triggers immediate inclusion.
- On Fuji public RPC, `unsafe: true` may be required because `debug_traceCall` is not available.

## 5) Fee configuration (demo)

Bundler cannot directly “charge” users on-chain in ERC‑4337; but it can:

- require minimum `maxPriorityFeePerGas`
- require `maxFeePerGas` headroom
- optionally “bid” by deciding how quickly it submits

Bundler1 defaults:

- higher min priority fee
- higher simulation strictness
- slower batching loop (e.g., submits every N seconds)

## 6) RPC methods

Bundler1 must implement the **standard** ERC‑4337 JSON‑RPC surface so it behaves like a real bundler.

Required:

- `eth_supportedEntryPoints()`
- `eth_sendUserOperation(userOp, entryPoint)`
- `eth_estimateUserOperationGas(userOp, entryPoint)`
- `eth_getUserOperationReceipt(userOpHash)`
- `eth_getUserOperationByHash(userOpHash)`

Optional (nice-to-have for a “full experience”):

- `pimlico_getUserOperationGasPrice()`
- `pimlico_getUserOperationStatus(userOpHash)`
- `pimlico_simulateAssetChanges(userOp, entryPoint)` (admin/debug UX)

### `eth_sendUserOperation(userOp, entryPoint)`

- Validate schema
- Run strict checks + simulate validation
- Store in in-memory pool
- Return `userOpHash`

Example JSON-RPC request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "eth_sendUserOperation",
  "params": [
    {
      "sender": "0x...",
      "nonce": "0x...",
      "factory": "0x...",
      "factoryData": "0x...",
      "callData": "0x...",
      "callGasLimit": "0x0",
      "verificationGasLimit": "0x0",
      "preVerificationGas": "0x0",
      "maxFeePerGas": "0x0",
      "maxPriorityFeePerGas": "0x0",
      "paymaster": "0x...",
      "paymasterVerificationGasLimit": "0x0",
      "paymasterPostOpGasLimit": "0x0",
      "paymasterData": "0x",
      "signature": "0x...",
      "eip7702Auth": null
    },
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
  ]
}
```

Response:

```json
{ "jsonrpc": "2.0", "id": 1, "result": "0xUserOpHash..." }
```

### `eth_getUserOperationReceipt(userOpHash)`

- Return txHash, success, logs, and decoded summary (best effort)

Minimum response shape for our UI:

```json
{
  "userOpHash": "0x...",
  "txHash": "0x...",
  "blockNumber": "0x...",
  "success": true,
  "sender": "0x...",
  "paymaster": "0x...",
  "actualGasUsed": "0x...",
  "actualGasCost": "0x..."
}
```

If we implement the fuller bundler-style shape, we can also include:

- `receipt` (transaction receipt object)
- `logs` (decoded `UserOperationEvent`, paymaster events)

## 7) Observability

Structured logs (ingested by admin):

- `userOpHash`, `sender`, `paymaster`, `bundlerId`, `decision` (accept/reject), `reasonCode`
