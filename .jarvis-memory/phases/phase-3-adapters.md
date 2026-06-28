# Phase 3 — Multi-Asset Broker Adapter Layer

## Goal

Abstract every broker behind a single `BrokerAdapter` interface so the
allocator + trade routes can dispatch by `assetClass` without knowing
whether they're trading equities (Alpaca), futures (Tradier?), forex
(Oanda?), or prediction markets (Kalshi).

## Step log

### 3.1 — Adapter interface (branch `phase-3.1/broker-adapter-interface`)

`src/lib/brokers/adapter.ts` defines:

- `AssetClass` union: equity, futures, forex, crypto, options, prediction
- `UnifiedOrder` shape (symbol, side, qty, type, limit_price, stop_price,
  take_profit, tif, client_order_id) — broker-agnostic
- `OrderResult`, `Quote`, `Bar`, `Position`, `AccountSnapshot` shared types
- `BrokerAdapter` interface: id, assetClass, displayName, + methods
  quote/bars/place/positions/account/isOpen
- `notImplemented(method, adapter)` helper for stub adapters

Pure types — no implementations yet. 3.2 wraps existing Alpaca code, 3.3
stubs futures + forex, 3.4 builds the dispatch registry.

### 3.2 — AlpacaAdapter (branch `phase-3.2/alpaca-adapter`)

`src/lib/brokers/alpaca.ts` exports `AlpacaAdapter` (id='alpaca',
assetClass='equity'). Wraps existing `getBars`/`getLatestQuote`/`getAccount`/
`getPositions` for read paths. `place(order)` POSTs to `/v2/orders` directly
(via `safeFetch`) supporting market+limit+bracket orders. `isOpen()` hits
`/v2/clock`.

Existing `/api/trade/route.ts` still works as-is — the adapter is additive.
3.4 wires `getAdapter('equity')` to return AlpacaAdapter and refactors the
trade route to dispatch through it.

### 3.3 — Stub futures + forex adapters (branch `phase-3.3/stub-adapters`)

- `src/lib/brokers/futures.ts` — `FuturesAdapterStub` (assetClass='futures').
  Provider candidates documented in source comment: Tradovate, Tradier, IBKR.
- `src/lib/brokers/forex.ts` — `ForexAdapterStub` (assetClass='forex').
  Recommended first: Oanda v20 practice API (free, no CC).
- Both throw `notImplemented` on every method except `isOpen()` which returns
  false (so the registry can mark them unavailable).

Next: 3.4 dispatch registry.