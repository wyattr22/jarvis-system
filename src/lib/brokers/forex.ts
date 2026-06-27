// Forex broker adapter — STUB.
//
// Implement once a provider is chosen. Candidates:
//   - Oanda v20 REST API (free practice account, no CC, full REST)  ← recommended first
//   - FXCM (deprecated)
//   - OANDA Stream API for tick data
//   - Interactive Brokers FX
//
// Oanda's practice tier matches the existing "zero credit card" constraint.
// Until then, every method throws via `notImplemented()`.

import type { BrokerAdapter } from "./adapter"
import { notImplemented } from "./adapter"

export const ForexAdapterStub: BrokerAdapter = {
  id: "forex-stub",
  assetClass: "forex",
  displayName: "Forex (not yet configured)",

  quote:     () => notImplemented("quote",     "ForexAdapter"),
  bars:      () => notImplemented("bars",      "ForexAdapter"),
  place:     () => notImplemented("place",     "ForexAdapter"),
  positions: () => notImplemented("positions", "ForexAdapter"),
  account:   () => notImplemented("account",   "ForexAdapter"),
  isOpen:    async () => false,
}
