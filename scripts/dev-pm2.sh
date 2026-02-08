#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[dev-pm2] %s\n' "$*"
}

wait_for_rpc() {
  local url="$1"
  local timeout_sec="$2"
  for _ in $(seq 1 "${timeout_sec}"); do
    if curl -fsS -X POST "${url}" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_http() {
  local url="$1"
  local timeout_sec="$2"
  for _ in $(seq 1 "${timeout_sec}"); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# 0. Cleanup Ports
kill_port() {
  local port=$1
  local pid=$(lsof -t -i:$port || true)
  if [ -n "$pid" ]; then
    log "Killing process on port $port (PID: $pid)..."
    kill -9 $pid || true
  fi
}

log "Cleaning up ports..."
for p in 8545 3001 3002 3003 3004 5173 5174 5175 5176; do
  kill_port $p
done
# Aggressive cleanup
pkill -9 anvil || true
pkill -9 node || true
sleep 2

# 1. Stop any existing PM2 processes
log "Stopping existing PM2 processes..."
npx pm2 delete all >/dev/null 2>&1 || true

# 2. Start Anvil only (needed for deployment)
log "Starting Anvil..."
npx pm2 start anvil --name anvil --interpreter none -- --chain-id 31337 --port 8545 --mnemonic 'test test test test test test test test test test test junk'

log "Waiting for Anvil RPC..."
if ! wait_for_rpc "http://127.0.0.1:8545" 10; then
  log "Anvil failed to start."
  exit 1
fi

# 3. Deploy Contracts
log "Deploying contracts..."
(cd "${ROOT_DIR}/paymaster" && DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" forge script script/Deploy.s.sol:Deploy --rpc-url "http://127.0.0.1:8545" --broadcast --slow --gas-price 2000000000)

log "Exporting ABIs..."
(cd "${ROOT_DIR}/paymaster" && ./scripts/export-abis.sh local)

# 4. Build Bundler Shared Engine
log "Building bundler..."
(cd "${ROOT_DIR}/bundler" && npm run build)

# 5. Start Remaining Services
log "Starting remaining services via PM2..."
npx pm2 start ecosystem.config.js

# 6. Wait for Monitor to ready up
log "Waiting for Monitor..."
if ! wait_for_http "http://127.0.0.1:3002/api/public/health" 30; then
  log "Monitor failed to start."
  npx pm2 logs monitor-backend --lines 50
  exit 1
fi

# 7. Spawn Bundlers
log "Spawning bundlers..."
ADMIN_TOKEN="dev_admin_token"
curl -fsS -X POST "http://127.0.0.1:3002/api/admin/bundlers/spawn" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"base":"bundler1"}' >/dev/null

curl -fsS -X POST "http://127.0.0.1:3002/api/admin/bundlers/spawn" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"base":"bundler2"}' >/dev/null

log "---------------------------------------------------"
log "Stack is UP (PM2 managed)"
log "Dashboard:  http://127.0.0.1:5173"
log "Monitor:    http://127.0.0.1:5174"
log "Explorer:   http://127.0.0.1:5175"
log "Oracle:     http://127.0.0.1:5176"
log "PM2 Status: npx pm2 status"
log "PM2 Logs:   npx pm2 logs"
log "Stop All:   npx pm2 stop all"
log "---------------------------------------------------"
