#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="${ROOT_DIR}/output/local-dev/pids"

QUIET=0
if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=1
fi

log() {
  if [[ "${QUIET}" -eq 0 ]]; then
    printf '[dev-down] %s\n' "$*"
  fi
}

stop_pid_file() {
  local pid_file="$1"
  local name
  local pid

  name="$(basename "${pid_file}" .pid)"
  pid="$(cat "${pid_file}" 2>/dev/null || true)"

  if [[ -z "${pid}" ]]; then
    rm -f "${pid_file}"
    return 0
  fi

  if kill -0 "${pid}" >/dev/null 2>&1; then
    log "Stopping ${name} (pid ${pid})"
    kill "${pid}" >/dev/null 2>&1 || true

    for _ in $(seq 1 20); do
      if ! kill -0 "${pid}" >/dev/null 2>&1; then
        break
      fi
      sleep 0.25
    done

    if kill -0 "${pid}" >/dev/null 2>&1; then
      log "Force killing ${name} (pid ${pid})"
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  fi

  rm -f "${pid_file}"
}


kill_port() {
  local port="$1"
  local pid
  pid="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)"

  if [[ -n "${pid}" ]]; then
    log "Killing process on port ${port} (pid ${pid})"
    kill "${pid}" >/dev/null 2>&1 || true
    
    # Wait loop
    for _ in $(seq 1 10); do
      if ! kill -0 "${pid}" >/dev/null 2>&1; then
        return 0
      fi
      sleep 0.2
    done

    if kill -0 "${pid}" >/dev/null 2>&1; then
       log "Force killing port ${port} (pid ${pid})"
       kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  fi
}

found=0
# 1. Stop managed PIDs
if [[ -d "${PID_DIR}" ]]; then
  for pid_file in "${PID_DIR}"/*.pid; do
    if [[ -f "${pid_file}" ]]; then
      found=1
      stop_pid_file "${pid_file}"
    fi
  done
fi

# 2. Cleanup known ports (aggressive cleanup)
# 8545: Anvil
# 3001: Quote Service
# 3002: Monitor
# 3003: Oracle
# 5173: Web
# 5174: Admin Web
# 5175: Explorer
# 5176: Oracle Web
PORTS=(8545 3001 3002 3003 5173 5174 5175 5176)

for port in "${PORTS[@]}"; do
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    found=1
    kill_port "${port}"
  fi
done

if [[ "${found}" -eq 0 ]]; then
  log "No managed processes found."
else
  log "Stopped all managed local demo processes."
fi
