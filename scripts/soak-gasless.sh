#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SOAK_ITERATIONS="${SOAK_ITERATIONS:-10}"
SOAK_AUTO_UP="${SOAK_AUTO_UP:-1}"
SOAK_AUTO_DOWN="${SOAK_AUTO_DOWN:-1}"
SOAK_PROFILE="${SOAK_PROFILE:-swap}" # swap | failover | paid-fallback

MONITOR_URL="${SOAK_MONITOR_URL:-http://127.0.0.1:3002}"
QUOTE_URL="${SOAK_QUOTE_URL:-http://127.0.0.1:3001}"
WEB_URL="${SOAK_WEB_URL:-http://127.0.0.1:5173}"
ADMIN_TOKEN="${SOAK_ADMIN_TOKEN:-dev_admin_token}"
OWNER_PRIVATE_KEY="${SOAK_OWNER_PRIVATE_KEY:-${E2E_OWNER_PRIVATE_KEY:-}}"

MAX_RUNNER_FAILURES="${MAX_RUNNER_FAILURES:-0}"
MAX_USEROP_FAILURES="${MAX_USEROP_FAILURES:-0}"
MAX_ERROR_LOGS="${MAX_ERROR_LOGS:-0}"
MIN_SUCCESSFUL_SWAPS="${MIN_SUCCESSFUL_SWAPS:-$SOAK_ITERATIONS}"

RUN_ID="$(date +%Y%m%d_%H%M%S)"
RUN_DIR="${ROOT_DIR}/output/soak/${RUN_ID}"
ATTEMPTS_DIR="${RUN_DIR}/attempts"
RUN_START_TS="$(date +%s)"

mkdir -p "${ATTEMPTS_DIR}"

log() {
  printf '[soak] %s\n' "$*"
}

usage() {
  cat <<'EOF'
Usage:
  ./scripts/soak-gasless.sh

Environment knobs:
  SOAK_ITERATIONS         Number of runs (default: 10)
  SOAK_PROFILE            swap | failover | paid-fallback (default: swap)
  SOAK_AUTO_UP            1 to run ./scripts/dev-up.sh first (default: 1)
  SOAK_AUTO_DOWN          1 to run ./scripts/dev-down.sh at end when auto-up was used (default: 1)
  SOAK_OWNER_PRIVATE_KEY  Required key for Playwright swap scripts (or E2E_OWNER_PRIVATE_KEY)
  SOAK_MONITOR_URL        Monitor base URL (default: http://127.0.0.1:3002)
  SOAK_QUOTE_URL          Quote base URL (default: http://127.0.0.1:3001)
  SOAK_WEB_URL            Web app URL (default: http://127.0.0.1:5173)
  SOAK_ADMIN_TOKEN        Monitor admin token (default: dev_admin_token)

Thresholds (used by analyzer; script exits non-zero when violated):
  MAX_RUNNER_FAILURES     default 0
  MAX_USEROP_FAILURES     default 0
  MAX_ERROR_LOGS          default 0
  MIN_SUCCESSFUL_SWAPS    default SOAK_ITERATIONS
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_http_200() {
  local url="$1"
  local label="$2"
  local timeout_s="${3:-60}"

  local start
  start="$(date +%s)"
  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if [[ $(( $(date +%s) - start )) -ge "$timeout_s" ]]; then
      echo "Timed out waiting for ${label}: ${url}" >&2
      return 1
    fi
    sleep 0.5
  done
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

require_cmd node
require_cmd curl
require_cmd npm

if [[ -z "${OWNER_PRIVATE_KEY}" ]]; then
  echo "Set SOAK_OWNER_PRIVATE_KEY (or E2E_OWNER_PRIVATE_KEY)." >&2
  exit 1
fi

STACK_STARTED=0
cleanup() {
  if [[ "${STACK_STARTED}" == "1" && "${SOAK_AUTO_DOWN}" == "1" ]]; then
    log "Stopping stack (auto-down enabled)"
    "${ROOT_DIR}/scripts/dev-down.sh" || true
  fi
}
trap cleanup EXIT

if [[ "${SOAK_AUTO_UP}" == "1" ]]; then
  log "Booting local stack with dev-up.sh"
  "${ROOT_DIR}/scripts/dev-up.sh"
  STACK_STARTED=1
fi

log "Waiting for required services"
wait_http_200 "${MONITOR_URL}/api/public/health" "monitor"
wait_http_200 "${QUOTE_URL}/health" "quote_service"
wait_http_200 "${WEB_URL}" "web app"

PROFILE_NPM_SCRIPT="e2e:swap"
if [[ "${SOAK_PROFILE}" == "failover" ]]; then
  PROFILE_NPM_SCRIPT="e2e:failover"
elif [[ "${SOAK_PROFILE}" == "paid-fallback" ]]; then
  PROFILE_NPM_SCRIPT="e2e:paid-fallback"
fi

log "Running ${SOAK_ITERATIONS} iterations with profile=${SOAK_PROFILE}"

attempt=1
runner_failures=0
while [[ "${attempt}" -le "${SOAK_ITERATIONS}" ]]; do
  attempt_log="${ATTEMPTS_DIR}/attempt_${attempt}.log"
  log "Attempt ${attempt}/${SOAK_ITERATIONS}"
  if (
    cd "${ROOT_DIR}/web" && \
    E2E_OWNER_PRIVATE_KEY="${OWNER_PRIVATE_KEY}" \
    E2E_MONITOR_URL="${MONITOR_URL}" \
    E2E_QUOTE_URL="${QUOTE_URL}" \
    E2E_WEB_URL="${WEB_URL}" \
    E2E_ADMIN_TOKEN="${ADMIN_TOKEN}" \
    npm run "${PROFILE_NPM_SCRIPT}"
  ) >"${attempt_log}" 2>&1; then
    echo "ok" > "${ATTEMPTS_DIR}/attempt_${attempt}.status"
  else
    runner_failures=$((runner_failures + 1))
    echo "failed" > "${ATTEMPTS_DIR}/attempt_${attempt}.status"
    log "Attempt ${attempt} failed (see ${attempt_log})"
  fi
  attempt=$((attempt + 1))
done

echo "${runner_failures}" > "${RUN_DIR}/runner_failures.txt"

log "Collecting monitor artifacts"
curl -fsS -H "authorization: Bearer ${ADMIN_TOKEN}" \
  "${MONITOR_URL}/api/admin/metrics/summary" > "${RUN_DIR}/summary.json"
curl -fsS -H "authorization: Bearer ${ADMIN_TOKEN}" \
  "${MONITOR_URL}/api/admin/userops?limit=10000" > "${RUN_DIR}/userops.json"
curl -fsS "${MONITOR_URL}/api/logs?since=${RUN_START_TS}&limit=20000" > "${RUN_DIR}/logs.json"

log "Analyzing run against thresholds"
set +e
node "${ROOT_DIR}/scripts/soak-analyze.mjs" \
  --summary "${RUN_DIR}/summary.json" \
  --userops "${RUN_DIR}/userops.json" \
  --logs "${RUN_DIR}/logs.json" \
  --attempts "${SOAK_ITERATIONS}" \
  --runner-failures "${runner_failures}" \
  --max-runner-failures "${MAX_RUNNER_FAILURES}" \
  --max-userop-failures "${MAX_USEROP_FAILURES}" \
  --max-error-logs "${MAX_ERROR_LOGS}" \
  --min-successful-swaps "${MIN_SUCCESSFUL_SWAPS}" \
  --report "${RUN_DIR}/report.json" > "${RUN_DIR}/report.stdout.json"
analyzer_exit="$?"
set -e

cat "${RUN_DIR}/report.stdout.json"
node "${ROOT_DIR}/scripts/soak-report-latest.mjs" "${RUN_DIR}"

if [[ "${analyzer_exit}" != "0" ]]; then
  log "Soak FAILED. See ${RUN_DIR}/report.json"
  exit 1
fi

log "Soak PASSED. Report: ${RUN_DIR}/report.json"
