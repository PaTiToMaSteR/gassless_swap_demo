# Agent Instructions (Repo Workflow)

This repo is a multi-service demo (no Docker) with a **docs-first** workflow. Treat every folder (`web/`, `bundler*/`, `paymaster/`, etc.) as an independently runnable component.

## Non‑negotiables

- **No Docker** (no `docker`, `docker-compose`, devcontainers, etc.).
- **One folder per element/service** (top-level folders are the mental model).
- **Paymaster policy is fully on‑chain** (no off-chain sponsorship signatures).
- Every meaningful change must be accompanied by:
  1) **tests**, 2) **docs updates**, 3) **TODO updates**.

## Required workflow for any change

1) Update design docs first (or in the same PR):
   - update the relevant component `PLAN.md` if behavior/spec changes
   - update `README.md` if setup/usage changes
2) Update task tracking:
   - update **both** the component `TODO.md` and the root `TODO.md` when applicable
3) Add or update tests:
   - include at least one **synthetic** test for the behavior you added/changed
4) Run tests locally before considering the change “done”:
   - component-level tests (fast)
   - then repo-level smoke/integration checks when relevant

If a change is *docs-only*, still run the lightest repo checks (e.g., markdown lint if present).

## Local development baseline

- Local chain: **Anvil** (Foundry) for fast iteration.
- Target deployment: **Avalanche Fuji** (C-Chain) for the final demo.

## Testing philosophy (synthetic tests)

“Synthetic tests” in this repo means:

- contracts: unit tests + one integration test covering the full sponsored flow
- bundler: JSON-RPC conformance + one end-to-end `sendUserOp → receipt` test
- quote_service: request/response schema + TTL/expiry behavior
- monitor backend: log ingest/query + bundler spawn lifecycle
- UIs: basic render tests + one happy-path interaction test (can be headless)

Prefer small, deterministic tests over large flaky e2e.

## Documentation rules

- Keep docs in sync with actual behavior.
- Any new endpoint or config field must be documented where it belongs:
  - service API → that service’s `PLAN.md` + `README.md`
  - shared assumptions → root `PLAN.md`

