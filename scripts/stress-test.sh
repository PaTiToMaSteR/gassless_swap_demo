#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STRESS_DURATION="${STRESS_DURATION:-60}"
STRESS_INTERVAL="${STRESS_INTERVAL:-500}" # 2 swaps per second

log() {
  printf '[stress-test] %s\n' "$*"
}

cleanup() {
  log "Cleaning up PM2..."
  npx pm2 stop all >/dev/null 2>&1 || true
  npx pm2 delete all >/dev/null 2>&1 || true
}
# trap cleanup EXIT

log "Booting stack (dev-pm2)"
"${ROOT_DIR}/scripts/dev-pm2.sh"

log "Executing stress test bot for ${STRESS_DURATION}s..."
STRESS_DURATION="${STRESS_DURATION}" \
STRESS_INTERVAL="${STRESS_INTERVAL}" \
npx tsx "${ROOT_DIR}/scripts/swap-bot.ts"

log "Stress test completed successfully."
