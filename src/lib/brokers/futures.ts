// Futures broker adapter — STUB.
//
// Implement once a provider is chosen. Candidates (all need an account, some
// are paid):
//   - Tradovate (developer API, $25/mo data feed)
//   - Tradier (futures data via add-on)
//   - Interactive Brokers (free for active accounts, complex API)
//   - NinjaTrader (broker bridge, no direct REST API)
//
// Until then, every method throws via `notImplemented()` so the type system
// + dispatch registry treat the asset class as known-but-unconfigured.

import type { BrokerAdapter } from "./adapter"
import { notImplemented } from "./adapter"

export const FuturesAdapterStub: BrokerAdapter = {
  id: "futures-stub",
  assetClass: "futures",
  displayName: "Futures (not yet configured)",

  quote:     () => notImplemented("quote",     "FuturesAdapter"),
  bars:      () => notImplemented("bars",      "FuturesAdapter"),
  place:     () => notImplemented("place",     "FuturesAdapter"),
  positions: () => notImplemented("positions", "FuturesAdapter"),
  account:   () => notImplemented("account",   "FuturesAdapter"),
  isOpen:    async () => false,
}
