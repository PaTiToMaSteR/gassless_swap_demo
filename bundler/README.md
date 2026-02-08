# bundler/ — ERC‑4337 Bundler Engine (MetaMask-inspired, v0.7)

This folder contains the **bundler engine** used by `bundler1/` and `bundler2/`.

Goals:

- Implement the standard ERC‑4337 JSON‑RPC bundler methods (v0.7 / unpacked UserOp)
- Submit `EntryPoint.handleOps()` transactions using a bundler EOA
- Support “many bundlers” via **config JSON** (fee floors, strict/lenient modes, bundling cadence)
- Work on:
  - local dev chain (**Anvil**) and
  - Avalanche **Fuji** public RPC (no `debug_traceCall`)

This is a forked/adapted design based on MetaMask’s `@metamask/test-bundler`, upgraded to **EntryPoint v0.7**.

## Run (CLI)

```bash
cd bundler
npm install
npm run build
node dist/cli.js --config /path/to/bundler.config.json
```

## Config

The engine reads a single JSON config file (path provided via `--config`).

See:

- `bundler1/bundler.config.example.json`
- `bundler2/bundler.config.example.json`

### Bundling cadence (important for demos)

For interactive demos (one UserOp at a time), ensure the bundler will actually include single operations:

- set `autoBundleMempoolSize: 1` so a single accepted UserOp triggers an immediate bundle

If you set `autoBundleMempoolSize > 1`, the engine will wait for a batch of that size before submitting `handleOps()`.

### Observability (logs)

Bundlers can emit structured logs (JSON) and optionally ship them to the admin/monitor backend:

- config: `observability.monitorUrl` (base URL, e.g. `http://127.0.0.1:3002`)
- endpoint: `POST ${monitorUrl}/api/logs/ingest`
- config: `observability.service` (defaults to `bundler`)

Events include correlation fields like `userOpHash`, `sender`, `txHash`, so the admin UI can filter/jump between related logs.

### Beneficiary (EntryPoint v0.7 / `AA90`)

EntryPoint v0.7 reverts if `beneficiary == address(0)` (`AA90 invalid beneficiary`).

For convenience in this demo:

- if config `beneficiary` is the zero address, the engine uses the **bundler wallet address** as beneficiary.

## Test

```bash
cd bundler
npm test
```
