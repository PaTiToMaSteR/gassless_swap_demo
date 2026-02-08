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

if [[ ! -d "${PID_DIR}" ]]; then
  log "No managed processes found."
  exit 0
fi

found=0
for pid_file in "${PID_DIR}"/*.pid; do
  if [[ -f "${pid_file}" ]]; then
    found=1
    stop_pid_file "${pid_file}"
  fi
done

if [[ "${found}" -eq 0 ]]; then
  log "No managed processes found."
else
  log "Stopped all managed local demo processes."
fi
