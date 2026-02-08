#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[test-all] %s\n' "$*"
}

fail=0

# 1. Paymaster (Foundry Tests)
log "Running Paymaster Tests (Foundry)..."
if (cd "${ROOT_DIR}/paymaster" && forge test); then
  log "✅ Paymaster Tests Passed"
else
  log "❌ Paymaster Tests Failed"
  fail=1
fi

# 2. Bundler (Unit & Integration)
log "Running Bundler Tests..."
# Note: Integration tests might fail if dependencies aren't running, but we run them anyway.
if (cd "${ROOT_DIR}/bundler" && npm test); then
  log "✅ Bundler Tests Passed"
else
  log "❌ Bundler Tests Failed"
  fail=1
fi

# 3. Explorer (Web Unit Tests)
log "Running Explorer Tests..."
if (cd "${ROOT_DIR}/explorer" && npm test -- --run); then
  log "✅ Explorer Tests Passed"
else
  log "❌ Explorer Tests Failed"
  fail=1
fi

# 4. Monitor Server (if any)
if [ -d "${ROOT_DIR}/paymaster_monitor/server/test" ]; then
    log "Running Monitor Server Tests..."
    if (cd "${ROOT_DIR}/paymaster_monitor/server" && npm test -- --run); then
        log "✅ Monitor Server Tests Passed"
    else
        log "❌ Monitor Server Tests Failed"
        fail=1
    fi
fi

# 5. Stress Test Bot (60s)
log "Running 60s Stress Test Bot..."
# Note: stress-test.sh handles dev-up/dev-down interally.
if STRESS_DURATION=60 "${ROOT_DIR}/scripts/stress-test.sh"; then
    log "✅ Stress Test Passed"
else
    log "❌ Stress Test Failed"
    fail=1
fi

if [ $fail -eq 0 ]; then
  log "🎉 ALL TESTS PASSED"
  exit 0
else
  log "💥 SOME TESTS FAILED"
  exit 1
fi
