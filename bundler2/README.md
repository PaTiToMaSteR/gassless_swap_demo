# bundler2/ — ERC‑4337 Bundler Instance (Fast/Lenient)

Bundler #2 is intentionally **lenient** to demonstrate:

- faster inclusion
- higher failure rate and better UX retries/failover

It exposes the same **full** ERC‑4337 JSON-RPC methods as `bundler1/` so the user app can switch bundlers seamlessly.

Bundler2 is an **instance config** over the shared engine in `bundler/`.

## Configuration

This bundler must be configurable via a local JSON file:

- `bundler.config.json` — editable knobs (fees/strictness/limits, plus demo toggles like delay/failure rate)
- start from `bundler.config.example.json`

Admin can spawn multiple bundler2 instances with different configs to simulate a “bundler marketplace”.

See `PLAN.md` for policy differences.

## Run

```bash
# build the shared engine once
cd bundler
npm install
npm run build

# start this instance (from bundler2/)
cd ../bundler2
export BUNDLER_PRIVATE_KEY=0x...
node ../bundler/dist/cli.js --config ./bundler.config.example.json
```

Notes:

- EntryPoint v0.7 reverts if `beneficiary` is the zero address (`AA90`). If config `beneficiary` is `0x0`, the engine uses the bundler wallet address.

## Runtime config (planned)

- `PORT` — default `3004`
- `CHAIN_ID` — default `43113` (Fuji)
- `RPC_URL` — Fuji RPC (public)
- `ENTRYPOINT_ADDRESS` — EntryPoint deployed by `paymaster/`
- `BUNDLER_PRIVATE_KEY` — EOA used to send `handleOps` txs
- `BUNDLER_ID` — identifier exposed to monitoring/admin (e.g. `bundler2`)
- `MIN_PRIORITY_FEE_GWEI` — lower than bundler1
- `STRICT_MODE` — `false` or configurable
- `DELAY_MS` — optional artificial delay for demos
- `FAILURE_RATE` — optional artificial rejection rate for demos
- `MONITOR_URL` — where to post logs/heartbeats (optional but recommended)

## Engine

- Shared engine: `bundler/` (MetaMask-inspired, v0.7)
- This folder: fast/lenient config + documentation
