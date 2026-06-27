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

Next: 3.2 AlpacaAdapter.