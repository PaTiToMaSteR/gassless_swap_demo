#!/usr/bin/env bash
set -euo pipefail

NETWORK="${1:-local}"
OUTDIR="deployments/${NETWORK}/abis"

mkdir -p "$OUTDIR"

forge inspect GaslessSwapPaymaster abi --json > "${OUTDIR}/GaslessSwapPaymaster.abi.json"
forge inspect MockPriceOracle abi --json > "${OUTDIR}/MockPriceOracle.abi.json"
forge inspect DemoRouter abi --json > "${OUTDIR}/DemoRouter.abi.json"
forge inspect DemoPool abi --json > "${OUTDIR}/DemoPool.abi.json"
forge inspect TestERC20 abi --json > "${OUTDIR}/TestERC20.abi.json"
forge inspect WNative abi --json > "${OUTDIR}/WNative.abi.json"

# ERC-4337 (v0.7)
forge inspect EntryPoint abi --json > "${OUTDIR}/EntryPoint.abi.json"
forge inspect SimpleAccount abi --json > "${OUTDIR}/SimpleAccount.abi.json"
forge inspect SimpleAccountFactory abi --json > "${OUTDIR}/SimpleAccountFactory.abi.json"

echo "Wrote ABIs to: ${OUTDIR}"
