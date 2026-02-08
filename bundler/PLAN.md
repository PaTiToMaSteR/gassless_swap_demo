# bundler/PLAN — v0.7 Compatibility + Simulation Strategy

## 1) Target protocol version

- EntryPoint: **v0.7**
- RPC UserOp shape: **unpacked v0.7** (`factory/factoryData`, `paymaster/paymasterData`, etc.)
- On-chain submission: pack into `PackedUserOperation` and call `EntryPoint.handleOps()`

## 2) Simulation on Fuji (no `debug_traceCall`)

Fuji public RPC does not expose `debug_traceCall`, so we cannot rely on geth-tracer-based opcode/storage validation.

Instead, we use **EntryPointSimulations** (AA v0.7) via `eth_call` + **state override**:

- Override the EntryPoint address code with `EntryPointSimulations` runtime bytecode
- Call:
  - `simulateValidation(packedUserOp)` for admission control + gas-ish numbers
  - (optional) `simulateHandleOp(...)` for deeper checks when available

This yields a believable bundler experience without requiring debug RPC methods.

## 3) Policy knobs (per bundler instance)

Config-driven behavior:

- fee floors: min `maxPriorityFeePerGas`, min `maxFeePerGas`
- strict vs lenient admission rules
- bundling cadence:
  - immediate (bundle per UserOp)
  - interval batching
- mempool limits: max ops, max per sender

Bundler1 and bundler2 are just **default configs** over the same engine.

## 4) RPC methods (required)

- `eth_supportedEntryPoints`
- `eth_sendUserOperation`
- `eth_estimateUserOperationGas`
- `eth_getUserOperationReceipt`
- `eth_getUserOperationByHash`
- `web3_clientVersion`

## 5) Observability hooks

Each bundler instance emits structured logs (JSON) and can optionally push them to:

- `paymaster_monitor/server` log ingestion endpoint

### 5.1 Config

Config lives in the bundler instance JSON:

```json
{
  "observability": {
    "monitorUrl": "http://127.0.0.1:3002",
    "service": "bundler1"
  }
}
```

If `monitorUrl` is set, the bundler posts log events to:

- `POST ${monitorUrl}/api/logs/ingest`

### 5.2 Events (minimum)

For the demo, we rely on the following event types:

- `bundler started` (network, entryPoint, policy)
- `userOp accepted` / `userOp rejected` (includes `userOpHash`, `sender`)
- `bundle attempt` / `bundle submitted` / `bundle failed`
- `userOp mined` (includes `userOpHash`, `sender`, `txHash`, `success`)

## 6) Open questions (track in TODO)

- How “strict” bundler1 should be on Fuji without trace
- How much of the MetaMask validation-manager to port vs replace
