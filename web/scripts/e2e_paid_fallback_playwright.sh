#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_http_200() {
  local url="$1"
  local label="$2"
  local timeout_s="${3:-30}"

  local start
  start="$(date +%s)"
  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if [[ $(( $(date +%s) - start )) -ge "$timeout_s" ]]; then
      echo "Timed out waiting for $label: $url" >&2
      return 1
    fi
    sleep 0.25
  done
}

pwcli() {
  npx --yes --package @playwright/cli@0.0.63 playwright-cli "$@"
}

pwcli_checked() {
  set +e
  local out code
  out="$(pwcli "$@" 2>&1)"
  code="$?"
  set -e

  echo "$out"
  if [[ "$code" != "0" ]] || echo "$out" | grep -q '### Error'; then
    return 1
  fi
}

pwcli_strict() {
  set +e
  local out code
  out="$(pwcli "$@" 2>&1)"
  code="$?"
  set -e

  echo "$out"
  if [[ "$code" != "0" ]] \
    || [[ "$out" == *"### Error"* ]] \
    || [[ "$out" == *"TimeoutError"* ]] \
    || [[ "$out" == *"Failed to connect to daemon"* ]] \
    || [[ "$out" == *"Session 'default' is not running."* ]]; then
    return 1
  fi
}

pwcli_retry() {
  local attempts="${1}"
  shift
  local n=1
  while [[ "$n" -le "$attempts" ]]; do
    if pwcli_strict "$@"; then
      return 0
    fi
    if [[ "$n" -eq "$attempts" ]]; then
      return 1
    fi
    sleep 1
    n=$((n + 1))
  done
}

require_cmd npx
require_cmd curl
require_cmd node
require_cmd cast

WEB_URL="${E2E_WEB_URL:-http://127.0.0.1:5173}"
MONITOR_URL="${E2E_MONITOR_URL:-http://127.0.0.1:3002}"
QUOTE_URL="${E2E_QUOTE_URL:-http://127.0.0.1:3001}"

OUTPUT_DIR="${E2E_OUTPUT_DIR:-$REPO_ROOT/output/playwright/web-paid-fallback}"
mkdir -p "$OUTPUT_DIR"
cd "$OUTPUT_DIR"

cleanup() {
  set +e
  pwcli session-stop >/dev/null 2>&1 || true
}

on_err() {
  set +e
  pwcli screenshot >/dev/null 2>&1 || true
  pwcli tracing-stop >/dev/null 2>&1 || true
}

trap on_err ERR
trap cleanup EXIT

wait_http_200 "$WEB_URL" "web app" 60
wait_http_200 "$MONITOR_URL/api/public/health" "monitor backend" 60
wait_http_200 "$QUOTE_URL/health" "quote_service" 60

DEPLOYMENTS_PATH="${E2E_DEPLOYMENTS_PATH:-$REPO_ROOT/paymaster/deployments/local/addresses.json}"
RPC_URL="${E2E_RPC_URL:-http://127.0.0.1:8545}"
OWNER_PRIVATE_KEY="${E2E_OWNER_PRIVATE_KEY:-}"
MINT_AMOUNT="${E2E_OWNER_TOKENIN_MINT_AMOUNT:-5000000000}" # 5000e6 (tUSDC)

if [[ ! -f "$DEPLOYMENTS_PATH" ]]; then
  echo "Missing deployments file: $DEPLOYMENTS_PATH" >&2
  exit 1
fi
if [[ -z "$OWNER_PRIVATE_KEY" ]]; then
  echo "Set E2E_OWNER_PRIVATE_KEY to the same key as VITE_DEV_PRIVATE_KEY." >&2
  exit 1
fi

ownerAddr="$(cast wallet address --private-key "$OWNER_PRIVATE_KEY")"
tokenInAddr="$(
  node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(j.usdc);" "$DEPLOYMENTS_PATH"
)"

echo "Minting tokenIn to owner wallet for paid fallback: $ownerAddr"
cast send "$tokenInAddr" "mint(address,uint256)" "$ownerAddr" "$MINT_AMOUNT" \
  --private-key "$OWNER_PRIVATE_KEY" \
  --rpc-url "$RPC_URL" >/dev/null

pwcli session-stop >/dev/null 2>&1 || true
headed="${E2E_HEADED:-0}"
if [[ "$headed" == "1" ]]; then
  pwcli_retry 3 --headed open "$WEB_URL"
else
  pwcli_retry 3 open "$WEB_URL"
fi
pwcli_retry 3 tracing-start

pwcli_retry 3 run-code "
  async () => {
  await page.goto('$WEB_URL', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const connectBtn = page.getByRole('button', { name: /connect/i });
  const label = (await connectBtn.textContent()) ?? '';
  if (!label.toLowerCase().includes('dev wallet')) {
    throw new Error('E2E requires dev-wallet mode (VITE_DEV_PRIVATE_KEY).');
  }

  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('domcontentloaded');
  // Wait for bundlers to appear in the status panel
  await page.getByText(/bundler1/i).waitFor({ timeout: 60_000 });

  await connectBtn.click({ force: true });
  await page.getByText(/Chain\\s+\\d+/).waitFor({ timeout: 60_000 });

  // Keep swap intentionally small so gasless sponsorship is denied.
  await page.getByPlaceholder('0.0').fill('1');
  await page.getByRole('button', { name: /get quote/i }).click({ force: true });
  await page.getByText(/Expires in/).waitFor({ timeout: 60_000 });

  await page.getByRole('button', { name: /gasless swap/i }).click({ force: true });
  await page.getByText(/pay gas yourself/i).waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: /swap paying gas/i }).click({ force: true });
  await page.getByText(/user-paid swap confirmed/i).waitFor({ timeout: 120_000 });
  }
"

pwcli_retry 3 run-code "
  async () => {
    const txValue = (await page.locator('.label', { hasText: 'Tx' }).locator('xpath=following-sibling::*[1]').first().textContent())?.trim() ?? '';
    if (!txValue || txValue === '—' || txValue.length < 10) {
      throw new Error('Paid fallback did not produce a transaction hash.');
    }
  }
"

pwcli_retry 3 screenshot
pwcli_retry 3 tracing-stop
pwcli_retry 3 close
pwcli session-stop

if find "$OUTPUT_DIR/.playwright-cli" -type f -name 'action-*.txt' -exec grep -H '### Error' {} + | grep -q '### Error'; then
  echo "Playwright reported runtime errors. See action logs under: $OUTPUT_DIR/.playwright-cli" >&2
  exit 1
fi

echo "E2E complete. Artifacts saved under: $OUTPUT_DIR/.playwright-cli/"
