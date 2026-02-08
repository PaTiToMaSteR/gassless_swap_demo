# paymaster/ — Contracts (EntryPoint v0.7, Paymaster, Demo DEX)

This folder owns the **on-chain** part of the gasless swap demo.

What’s implemented:

- ERC‑4337 **EntryPoint v0.7** (local deploy) via `eth-infinitism/account-abstraction@v0.7.0`
- Smart account: `SimpleAccount` + `SimpleAccountFactory` (AA sample)
- `GaslessSwapPaymaster` — **fully on-chain** sponsorship policy
- Demo DEX: `DemoPool` + `DemoRouter` (deterministic constant-product AMM)
- Demo tokens: `TestERC20` (“tUSDC”, 6 decimals) + `WNative` (“WAVAX”, 1:1 wrapped native)

## Prereqs

- Foundry (`forge`, `anvil`, `cast`)

## Test

```bash
cd paymaster
forge test
```

## Local chain (Anvil) + deploy

Start Anvil (deterministic keys):

```bash
anvil --mnemonic "test test test test test test test test test test test junk" --chain-id 31337
```

Deploy to local Anvil:

```bash
cd paymaster
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

Outputs:

- `paymaster/deployments/local/addresses.json`

Export ABIs (for other services):

```bash
cd paymaster
./scripts/export-abis.sh local
```

## Deploy to Fuji (contracts + existing EntryPoint)

Fuji uses an existing EntryPoint v0.7:

- `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

Deploy (uses the EntryPoint override):

```bash
cd paymaster
ENTRYPOINT_ADDRESS=0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
DEPLOYER_PRIVATE_KEY=0x... \
  forge script script/Deploy.s.sol:Deploy --rpc-url https://api.avax-test.network/ext/bc/C/rpc --broadcast
```

Outputs:

- `paymaster/deployments/fuji/addresses.json`

Export ABIs:

```bash
cd paymaster
./scripts/export-abis.sh fuji
```

## Paymaster policy (implemented)

`GaslessSwapPaymaster` validates (on-chain) that `userOp.callData` is a `SimpleAccount.executeBatch(...)` with **exactly**:

1) `tokenIn.approve(router, amountIn)`
2) `router.swapExactIn(tokenIn, tokenOut, amountIn, minOut, to=smartAccount, deadline)`
3) `tokenOut.transfer(paymaster, feeAmount)`

And enforces:

- allowlisted router + token pair (`tokenIn`, `tokenOut`)
- deterministic quote check: `router.quoteExactIn(...) >= minOut`
- **fee >= maxCost buffer** (fee is in `tokenOut` / WAVAX for a clean comparison to gas)

See `PLAN.md` for the rationale and the rest of the design.
