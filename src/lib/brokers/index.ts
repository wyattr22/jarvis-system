// Broker adapter registry.
//
// `getAdapter(assetClass)` returns the configured adapter for that class.
// Currently:
//   equity  → AlpacaAdapter (live)
//   futures → FuturesAdapterStub (throws on use)
//   forex   → OandaAdapter when OANDA_API_KEY is configured (Phase 15),
//             else ForexAdapterStub (throws on use)
//   crypto  → AlpacaAdapter (same broker, same API)
//
// Add new adapters by registering them in the map below.

import type { AssetClass, BrokerAdapter } from "./adapter"
import { AlpacaAdapter } from "./alpaca"
import { FuturesAdapterStub } from "./futures"
import { ForexAdapterStub } from "./forex"
import { OandaAdapter } from "./oanda"

const REGISTRY: Partial<Record<AssetClass, BrokerAdapter>> = {
  equity:  AlpacaAdapter,
  crypto:  AlpacaAdapter,   // Alpaca supports crypto via the same /v2/orders endpoint
  futures: FuturesAdapterStub,
  // Falls back to the stub when unconfigured rather than crashing the
  // registry — a misconfigured/absent OANDA_API_KEY should degrade to the
  // existing "not implemented" error, not break every other asset class.
  forex:   process.env.OANDA_API_KEY ? OandaAdapter : ForexAdapterStub,
}

export function getAdapter(assetClass: AssetClass): BrokerAdapter {
  const adapter = REGISTRY[assetClass]
  if (!adapter) {
    throw new Error(`no broker adapter registered for asset class: ${assetClass}`)
  }
  return adapter
}

export function listAdapters(): { assetClass: AssetClass; id: string; displayName: string }[] {
  return Object.entries(REGISTRY).map(([cls, a]) => ({
    assetClass: cls as AssetClass,
    id: a!.id,
    displayName: a!.displayName,
  }))
}

// Re-export the types so callers can `import { AssetClass, ... } from "@/lib/brokers"`.
export type { AssetClass, BrokerAdapter, UnifiedOrder, OrderResult, Quote, Bar, Position, AccountSnapshot } from "./adapter"
