# bundler1/ — ERC‑4337 Bundler Instance (Strict)

Bundler #1 is intentionally **strict** to demonstrate:

- higher rejection rate when parameters are unsafe
- slower but safer inclusion

Bundler1 is an **instance config** over the shared engine in `bundler/`.

It exposes a **full ERC‑4337 bundler JSON‑RPC surface** for `web/`:

- `eth_supportedEntryPoints`
- `eth_sendUserOperation`
- `eth_estimateUserOperationGas`
- `eth_getUserOperationReceipt`
- `eth_getUserOperationByHash`

## Configuration

This bundler must be configurable via a local JSON file:

- `bundler.config.json` — editable knobs (fees/strictness/limits)
- start from `bundler.config.example.json`

The admin backend (`paymaster_monitor/server`) can also spawn additional bundler instances by generating config JSON files and starting processes.

See `PLAN.md` for the strict policy choices.

## Run

```bash
# build the shared engine once
cd bundler
npm install
npm run build

# start this instance (from bundler1/)
cd ../bundler1
export BUNDLER_PRIVATE_KEY=0x...
node ../bundler/dist/cli.js --config ./bundler.config.example.json
```

Notes:

- EntryPoint v0.7 reverts if `beneficiary` is the zero address (`AA90`). If config `beneficiary` is `0x0`, the engine uses the bundler wallet address.

## Runtime config (planned)

- `PORT` — default `3003`
- `CHAIN_ID` — default `43113` (Fuji)
- `RPC_URL` — Fuji RPC (public)
- `ENTRYPOINT_ADDRESS` — EntryPoint deployed by `paymaster/`
- `BUNDLER_PRIVATE_KEY` — EOA used to send `handleOps` txs
- `BUNDLER_ID` — identifier exposed to monitoring/admin (e.g. `bundler1`)
- `MIN_PRIORITY_FEE_GWEI` — strict minimum
- `STRICT_MODE` — `true`
- `MONITOR_URL` — where to post logs/heartbeats (optional but recommended)

## Engine

- Shared engine: `bundler/` (MetaMask-inspired, v0.7)
- This folder: strict config + documentation
