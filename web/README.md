# web/ — User Swap App (React + Vite + ethers.js)

User-facing app that demonstrates:

- “one-click” gasless swap (one signature)
- quote expiry + rebuild
- bundler selection/failover
- paymaster denial fallbacks (“pay gas yourself”, reduce size, change route)

## UX style target

Dark theme with a macOS-like desktop feel:

- subtle window chrome / titlebar
- web-native titlebar (no fake close/minimize/zoom controls)
- blurred panels, thin borders, soft shadows
- SF-ish font stack
- high-contrast, low-saturation palette (good for dashboards)

## Dependencies / stack

- React + Vite + TypeScript
- `ethers.js` for RPC + signing
- custom CSS variables for a macOS-like dark UI

## Integrations

- Quote: `quote_service/` (`GET/POST /quote`)
- Bundlers: list from `paymaster_monitor/server` (`GET /api/public/bundlers`)
- Submit UserOp: chosen bundler JSON-RPC (`eth_sendUserOperation`)
- Gas estimation: the app calls `eth_estimateUserOperationGas` with a **non-zero** paymaster fee (computed from on-chain paymaster policy) so fully on-chain sponsorship validation passes during estimation
- Status: on-chain confirmation via `EntryPoint.UserOperationEvent` logs (`eth_getLogs`) so the UI is not tied to a single bundler

See `PLAN.md` for exact screens, flows, and API shapes.

## Runtime config

The app runs standalone with a local `.env`:

- `VITE_RPC_URL` — chain RPC (Fuji or local), e.g. `https://api.avax-test.network/ext/bc/C/rpc`
- `VITE_QUOTE_SERVICE_URL` — e.g. `http://127.0.0.1:3001`
- `VITE_MONITOR_URL` — admin/monitor backend for bundler list + telemetry, e.g. `http://127.0.0.1:3002`
- `VITE_DEV_PRIVATE_KEY` (optional, **dev-only**) — enables “Dev Wallet” mode (no MetaMask). The app uses this key to sign UserOp hashes for automation/testing.

Contract addresses are fetched from the monitor backend (`GET /api/public/deployments`).

## Run

```bash
cd web
npm install

cp .env.example .env
npm run dev
```

Notes:

- The app expects `paymaster_monitor/server` and `quote_service` to be running.
- Wallet connect uses MetaMask (`window.ethereum`) by default.
- For automation/headless flows, set `VITE_DEV_PRIVATE_KEY` and use “Dev Wallet” mode.

## Playwright automation (E2E happy path)

This repo uses Playwright CLI (`@playwright/cli`) to drive a real browser.

Prereqs:

- `web/` is running at `http://127.0.0.1:5173` with `VITE_DEV_PRIVATE_KEY` set.
- `quote_service/` is running at `http://127.0.0.1:3001`.
- `paymaster_monitor/server` is running at `http://127.0.0.1:3002` (and can spawn bundlers).
- Foundry `cast` is available (used to mint demo funds to the counterfactual smart account).

Run:

```bash
cd web
E2E_OWNER_PRIVATE_KEY=0x... ./scripts/e2e_gasless_swap_playwright.sh
# or:
# E2E_OWNER_PRIVATE_KEY=0x... npm run e2e:swap
```

Artifacts are written under `output/playwright/web-gasless-swap/.playwright-cli/`.

## Playwright automation (bundler failover)

This test spawns a special bundler instance with `policy.failureRate=1` (it will always reject `eth_sendUserOperation`), then asserts the UI automatically fails over to another bundler and still completes the swap.

Run:

```bash
cd web
E2E_OWNER_PRIVATE_KEY=0x... ./scripts/e2e_bundler_failover_playwright.sh
# or:
# E2E_OWNER_PRIVATE_KEY=0x... npm run e2e:failover
```

Artifacts are written under `output/playwright/web-bundler-failover/.playwright-cli/`.

## Playwright automation (paid fallback path)

This test forces a gasless failure (small amount that fails paymaster sponsorship constraints), then verifies the UI fallback path executes a direct user-paid swap.

Run:

```bash
cd web
E2E_OWNER_PRIVATE_KEY=0x... ./scripts/e2e_paid_fallback_playwright.sh
# or:
# E2E_OWNER_PRIVATE_KEY=0x... npm run e2e:paid-fallback
```

Artifacts are written under `output/playwright/web-paid-fallback/.playwright-cli/`.

## Soak testing (repeated swaps)

For repeated runs with artifact collection and threshold-based pass/fail, use the root soak runner:

```bash
cd ..
SOAK_OWNER_PRIVATE_KEY=0x... SOAK_ITERATIONS=20 SOAK_PROFILE=swap ./scripts/soak-gasless.sh
```

Use `SOAK_PROFILE=failover` to repeatedly exercise bundler failover behavior.
