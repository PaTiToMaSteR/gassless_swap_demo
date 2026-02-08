# quote_service/PLAN — API + Routing Model

## 1) Responsibilities

- Provide quotes for supported token pairs
- Provide a TTL (`deadline`) to enforce expiry on-chain
- Return **router calldata** (or structured route) used inside `executeBatch()`

## 2) Quote API (draft)

### `POST /quote`

Request:

```json
{
  "chainId": 43113,
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountIn": "1000000",
  "slippageBps": 50,
  "sender": "0x..."
}
```

Response:

```json
{
  "quoteId": "uuid-or-hash",
  "createdAt": 1730000000,
  "expiresAt": 1730000000,
  "deadline": 1730000000,
  "amountOut": "12345",
  "minOut": "12283",
  "route": {
    "router": "0x...",
    "calldata": "0x..."
  }
}
```

Notes:

- `deadline` is enforced by the router call (so paymaster can check it on-chain).
- `minOut` is the **net** minimum if we include explicit fee transfer; we’ll lock this in `paymaster/PLAN.md`.
- `sender` is required so the service can encode router calldata with `to=sender` (required by the on-chain paymaster policy).

### `GET /quote/:quoteId`

Returns the quote if it is still valid; returns HTTP `410` if expired.

### `GET /health`

Returns 200 if:

- RPC is reachable
- required deployments (router/tokens) are configured

### (Optional) `GET /config`

Expose supported pairs + TTL defaults for the UI/admin to display.

## 3) Routing options (design space)

For the demo we want deterministic + inspectable routing.

Option A (recommended demo):

- A single on-chain pool (constant product) per pair
- quote_service reads reserves and computes output

Option B:

- Multiple pools + choose best (still deterministic)

Option C (realistic, not required for demo):

- integrate 1inch/Uniswap SDK-like routing

## 4) Quote expiry + rebuild

- Keep TTL short (30–60s) to demonstrate expiry UX.
- The UI will show countdown and offer a one-click rebuild.

## 5) Observability

Every response includes a `quoteId` which is used to correlate:

- UI events
- bundler acceptance
- on-chain events (if we embed quoteId in calldata or emit it)

Embedding quoteId on-chain is optional; if desired, we can include it as an event in Smart Account execution.
