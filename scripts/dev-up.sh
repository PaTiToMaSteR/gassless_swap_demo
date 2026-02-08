#!/usr/bin/env bash
set -euo pipefail

# Unset NODE_OPTIONS to prevent debugger from attaching automatically if set in user env
unset NODE_OPTIONS
export NODE_OPTIONS=""

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/output/local-dev"
LOG_DIR="${OUTPUT_DIR}/logs"
PID_DIR="${OUTPUT_DIR}/pids"
DATA_DIR="${OUTPUT_DIR}/data"

RPC_URL_LOCAL="http://127.0.0.1:8545"
MONITOR_URL="http://127.0.0.1:3002"
QUOTE_URL="http://127.0.0.1:3001"
WEB_URL="http://127.0.0.1:5173"
ADMIN_WEB_URL="http://127.0.0.1:5174"
EXPLORER_URL="http://127.0.0.1:5175"
WEB_URL="http://127.0.0.1:5173"
ADMIN_WEB_URL="http://127.0.0.1:5174"
EXPLORER_URL="http://127.0.0.1:5175"
ORACLE_URL="http://127.0.0.1:3003"
ORACLE_WEB_URL="http://127.0.0.1:5176"

ANVIL_MNEMONIC="test test test test test test test test test test test junk"
DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev_admin_token}"

log() {
  printf '[dev-up] %s\n' "$*"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    printf '[dev-up] Missing required command: %s\n' "${cmd}" >&2
    exit 1
  fi
}

ensure_node_modules() {
  local dir="$1"
  if [[ ! -d "${dir}/node_modules" ]]; then
    log "Installing npm dependencies in ${dir#${ROOT_DIR}/}"
    (cd "${dir}" && npm install)
  fi
}

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_rpc() {
  local timeout_sec="$1"
  for _ in $(seq 1 "${timeout_sec}"); do
    if curl -fsS -X POST "${RPC_URL_LOCAL}" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  printf '[dev-up] Timed out waiting for RPC at %s\n' "${RPC_URL_LOCAL}" >&2
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

  printf '[dev-up] Timed out waiting for HTTP endpoint: %s\n' "${url}" >&2
  return 1
}

start_process() {
  local name="$1"
  local command="$2"
  local log_file="${LOG_DIR}/${name}.log"
  local pid_file="${PID_DIR}/${name}.pid"


  log "Starting ${name}"
  # Unset NODE_OPTIONS inside the subshell in case it's set by .bashrc/.zshrc
  nohup bash -lc "unset NODE_OPTIONS; ${command}" >"${log_file}" 2>&1 &
  local pid=$!
  echo "${pid}" > "${pid_file}"
}

fail_cleanup() {
  printf '[dev-up] Startup failed. Cleaning up managed processes.\n' >&2
  "${ROOT_DIR}/scripts/dev-down.sh" --quiet || true
}


trap fail_cleanup ERR

require_cmd anvil
require_cmd forge
require_cmd npm
require_cmd curl
require_cmd lsof

mkdir -p "${LOG_DIR}" "${PID_DIR}" "${DATA_DIR}"

"${ROOT_DIR}/scripts/dev-down.sh" --quiet || true

log "Ensuring service dependencies are installed"
ensure_node_modules "${ROOT_DIR}/bundler"
ensure_node_modules "${ROOT_DIR}/paymaster_monitor/server"
ensure_node_modules "${ROOT_DIR}/quote_service"
ensure_node_modules "${ROOT_DIR}/web"
ensure_node_modules "${ROOT_DIR}/paymaster_monitor/web"
ensure_node_modules "${ROOT_DIR}/explorer"

if wait_for_rpc 1; then
  log "Found running RPC at ${RPC_URL_LOCAL}; reusing existing local chain"
else
  if is_port_listening 8545; then
    printf '[dev-up] Port 8545 is occupied by a non-RPC process. Free it and rerun.\n' >&2
    exit 1
  fi
  start_process "anvil" "cd '${ROOT_DIR}' && exec anvil --mnemonic '${ANVIL_MNEMONIC}' --chain-id 31337"
  wait_for_rpc 20
fi

for port in 3001 3002 3003 5173 5174 5175 5176; do
  if is_port_listening "${port}"; then
    printf '[dev-up] Port %s is already in use. Stop the process and rerun.\n' "${port}" >&2
    exit 1
  fi
done

log "Deploying contracts to local Anvil"
(cd "${ROOT_DIR}/paymaster" && DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY}" forge script script/Deploy.s.sol:Deploy --rpc-url "${RPC_URL_LOCAL}" --broadcast)

log "Exporting ABIs for local deployment"
(cd "${ROOT_DIR}/paymaster" && ./scripts/export-abis.sh local)

log "Building shared bundler engine"
(cd "${ROOT_DIR}/bundler" && npm run build)

start_process \
  "monitor" \
  "cd '${ROOT_DIR}/paymaster_monitor/server' && exec env RPC_URL='${RPC_URL_LOCAL}' DEPLOYMENTS_PATH='../../paymaster/deployments/local/addresses.json' ADMIN_TOKEN='${ADMIN_TOKEN}' DATA_DIR='${DATA_DIR}/monitor' BUNDLER_PRIVATE_KEY='${DEPLOYER_PRIVATE_KEY}' BUNDLER_PORT_RANGE='3100-3199' npm run dev"
wait_for_http "${MONITOR_URL}/api/public/health" 60

start_process \
  "quote_service" \
  "cd '${ROOT_DIR}/quote_service' && exec env RPC_URL='${RPC_URL_LOCAL}' DEPLOYMENTS_PATH='../paymaster/deployments/local/addresses.json' DATA_DIR='${DATA_DIR}/quote' LOG_INGEST_URL='${MONITOR_URL}/api/logs/ingest' npm run dev"
wait_for_http "${QUOTE_URL}/health" 60

start_process \
  "web" \
  "cd '${ROOT_DIR}/web' && exec env VITE_RPC_URL='${RPC_URL_LOCAL}' VITE_MONITOR_URL='${MONITOR_URL}' VITE_QUOTE_SERVICE_URL='${QUOTE_URL}' VITE_DEV_PRIVATE_KEY='${DEPLOYER_PRIVATE_KEY}' npm run dev -- --host 127.0.0.1 --port 5173"
wait_for_http "${WEB_URL}" 30

start_process \
  "admin_web" \
  "cd '${ROOT_DIR}/paymaster_monitor/web' && exec env VITE_MONITOR_URL='${MONITOR_URL}' VITE_ADMIN_TOKEN='${ADMIN_TOKEN}' npm run dev -- --host 127.0.0.1 --port 5174"
wait_for_http "${ADMIN_WEB_URL}" 30

start_process \
  "explorer" \
  "cd '${ROOT_DIR}/explorer' && exec env VITE_RPC_URL='${RPC_URL_LOCAL}' npm run dev -- --host 127.0.0.1 --port 5175"
wait_for_http "${EXPLORER_URL}" 30

start_process \
  "oracle_service" \
  "cd '${ROOT_DIR}/oracle_service/server' && exec env PORT=3003 DEPLOYMENTS_PATH='../../paymaster/deployments/local/addresses.json' DEPLOYER_PRIVATE_KEY='${DEPLOYER_PRIVATE_KEY}' npm run dev"
wait_for_http "${ORACLE_URL}/status" 60

start_process \
  "oracle_web" \
  "cd '${ROOT_DIR}/oracle_service/web' && exec env npm run dev -- --host 127.0.0.1 --port 5176"
wait_for_http "${ORACLE_WEB_URL}" 90

log "Spawning bundler1 and bundler2 via monitor admin API"
curl -fsS -X POST "${MONITOR_URL}/api/admin/bundlers/spawn" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"base":"bundler1"}' >/dev/null

curl -fsS -X POST "${MONITOR_URL}/api/admin/bundlers/spawn" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"base":"bundler2"}' >/dev/null

trap - ERR

log "Local demo stack is running."
log "User app:   ${WEB_URL}"
log "Admin app:  ${ADMIN_WEB_URL}"
log "Monitor:    ${MONITOR_URL}"
log "Quote API:  ${QUOTE_URL}"
log "Logs dir:   ${LOG_DIR}"
log "Explorer:   ${EXPLORER_URL}"
log "Oracle Service: ${ORACLE_URL} (backend) / ${ORACLE_WEB_URL} (frontend)"
log "Stop all:   ${ROOT_DIR}/scripts/dev-down.sh"
