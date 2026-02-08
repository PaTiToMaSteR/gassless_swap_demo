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
  if [[ "$code" != "0" ]] || echo "$out" | grep -q '^### Error'; then
    return 1
  fi
}

require_cmd npx
require_cmd curl
require_cmd node

WEB_URL="${E2E_WEB_URL:-http://127.0.0.1:5173}"
MONITOR_URL="${E2E_MONITOR_URL:-http://127.0.0.1:3002}"
QUOTE_URL="${E2E_QUOTE_URL:-http://127.0.0.1:3001}"

OUTPUT_DIR="${E2E_OUTPUT_DIR:-$REPO_ROOT/output/playwright/web-gasless-swap}"
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

spawn_bundlers="${E2E_SPAWN_BUNDLERS:-1}"
if [[ "$spawn_bundlers" == "1" ]]; then
  bundlerCount="$(
    curl -fsS "$MONITOR_URL/api/public/bundlers" \
      | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(Array.isArray(j)?j.length:0);});"
  )"
  if [[ "${bundlerCount:-0}" == "0" ]]; then
    adminToken="${E2E_ADMIN_TOKEN:-dev_admin_token}"
    echo "No bundlers registered; spawning bundler1 + bundler2 via monitor admin API..."
    curl -fsS -X POST "$MONITOR_URL/api/admin/bundlers/spawn" \
      -H "authorization: Bearer $adminToken" \
      -H "content-type: application/json" \
      -d '{"base":"bundler1"}' >/dev/null
    curl -fsS -X POST "$MONITOR_URL/api/admin/bundlers/spawn" \
      -H "authorization: Bearer $adminToken" \
      -H "content-type: application/json" \
      -d '{"base":"bundler2"}' >/dev/null

    echo "Waiting for at least one bundler to report UP..."
    start="$(date +%s)"
    while true; do
      upCount="$(
        curl -fsS "$MONITOR_URL/api/public/bundlers" \
          | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const up=(Array.isArray(j)?j:[]).filter(b=>b&&b.status==='UP');console.log(up.length);});"
      )"
      if [[ "${upCount:-0}" -ge 1 ]]; then
        break
      fi
      if [[ $(( $(date +%s) - start )) -ge 30 ]]; then
        echo "Bundlers did not come up. Common fixes:" >&2
        echo "  - Build bundler engine: (cd bundler && npm install && npm run build)" >&2
        echo "  - Ensure monitor has BUNDLER_PRIVATE_KEY set" >&2
        exit 1
      fi
      sleep 0.5
    done
  fi
fi

mint="${E2E_MINT_TOKENIN:-1}"
if [[ "$mint" == "1" ]]; then
  require_cmd cast

  DEPLOYMENTS_PATH="${E2E_DEPLOYMENTS_PATH:-$REPO_ROOT/paymaster/deployments/local/addresses.json}"
  RPC_URL="${E2E_RPC_URL:-http://127.0.0.1:8545}"
  OWNER_PRIVATE_KEY="${E2E_OWNER_PRIVATE_KEY:-}"
  FUNDER_PRIVATE_KEY="${E2E_FUNDER_PRIVATE_KEY:-$OWNER_PRIVATE_KEY}"
  MINT_AMOUNT="${E2E_TOKENIN_MINT_AMOUNT:-1000000000}" # 1000e6 (tUSDC)

  if [[ ! -f "$DEPLOYMENTS_PATH" ]]; then
    echo "Missing deployments file: $DEPLOYMENTS_PATH" >&2
    echo "Deploy contracts first (see paymaster/README.md)." >&2
    exit 1
  fi
  if [[ -z "$OWNER_PRIVATE_KEY" ]]; then
    echo "Set E2E_OWNER_PRIVATE_KEY to the same key as VITE_DEV_PRIVATE_KEY (dev wallet)." >&2
    exit 1
  fi

  ownerAddr="$(cast wallet address --private-key "$OWNER_PRIVATE_KEY")"
  factoryAddr="$(
    node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(j.simpleAccountFactory);" "$DEPLOYMENTS_PATH"
  )"
  tokenInAddr="$(
    node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(j.tokenIn);" "$DEPLOYMENTS_PATH"
  )"

  senderAddr="$(cast call "$factoryAddr" "getAddress(address,uint256)(address)" "$ownerAddr" 0 --rpc-url "$RPC_URL")"

  echo "Minting tokenIn to smart account: $senderAddr"
  cast send "$tokenInAddr" "mint(address,uint256)" "$senderAddr" "$MINT_AMOUNT" \
    --private-key "$FUNDER_PRIVATE_KEY" \
    --rpc-url "$RPC_URL" >/dev/null
fi

pwcli session-stop >/dev/null 2>&1 || true
headed="${E2E_HEADED:-0}"
if [[ "$headed" == "1" ]]; then
  pwcli_checked --headed open "$WEB_URL"
else
  pwcli_checked open "$WEB_URL"
fi
pwcli_checked tracing-start

pwcli_checked run-code "
  async () => {
  // Fail fast if dev-wallet mode is not enabled.
  const connectBtn = page.getByRole('button', { name: /connect/i });
  const label = (await connectBtn.textContent()) ?? '';
  if (!label.toLowerCase().includes('dev wallet')) {
    throw new Error('E2E requires web dev-wallet mode. Start web/ with VITE_DEV_PRIVATE_KEY set so the UI shows “Connect Dev Wallet”.');
  }

  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.querySelectorAll('select option').length > 0, null, { timeout: 60_000 });

  await connectBtn.click();
  await page.getByText(/Chain\\s+\\d+/).waitFor({ timeout: 60_000 });

  await page.getByPlaceholder('0.0').fill('1000');
  await page.getByRole('button', { name: /get quote/i }).click();
  await page.getByText(/Expires in/).waitFor({ timeout: 60_000 });

  await page.getByRole('button', { name: /gasless swap/i }).click();

  await page.waitForFunction(() => {
    const steps = Array.from(document.querySelectorAll('.steps .step'));
    const row = steps.find((el) => (el.textContent ?? '').includes('Swap success'));
    if (!row) return false;
    const state = row.querySelector('.state')?.textContent ?? '';
    return state.trim() === 'done';
  }, null, { timeout: 120_000 });
  }
"

pwcli_checked screenshot
pwcli_checked tracing-stop
pwcli_checked close
pwcli session-stop

echo "E2E complete. Artifacts saved under: $OUTPUT_DIR/.playwright-cli/"
