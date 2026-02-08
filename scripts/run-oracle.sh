#!/usr/bin/env bash
set -euo pipefail

# Ensure we are at repo root
cd "$(dirname "$0")/.."

# Load env from .env if exists (optional, but good practice)
if [ -f .env ]; then
  export $(cat .env | xargs)
fi

# Set default envs for Oracle Service
export PORT=3003
export HOST=127.0.0.1
export RPC_URL=http://127.0.0.1:8545
export DEPLOYMENTS_PATH=$(pwd)/paymaster/deployments/local/addresses.json
export DEPLOYER_PRIVATE_KEY=${DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}

echo "Starting Oracle Service..."
echo "Backend: http://localhost:3003"
echo "Frontend: http://localhost:5176"

# Start Backend
(
  cd oracle_service/server
  npm run dev
) &

# Start Frontend
(
  cd oracle_service/web
  npm run dev
) &

wait
