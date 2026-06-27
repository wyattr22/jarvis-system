// Broker adapter registry.
//
// `getAdapter(assetClass)` returns the configured adapter for that class.
// Currently:
//   equity  → AlpacaAdapter (live)
//   futures → FuturesAdapterStub (throws on use)
//   forex   → ForexAdapterStub (throws on use)
//   crypto  → AlpacaAdapter (same broker, same API)
//
// Add new adapters by registering them in the map below.

import type { AssetClass, BrokerAdapter } from "./adapter"
import { AlpacaAdapter } from "./alpaca"
import { FuturesAdapterStub } from "./futures"
import { ForexAdapterStub } from "./forex"

const REGISTRY: Partial<Record<AssetClass, BrokerAdapter>> = {
  equity:  AlpacaAdapter,
  crypto:  AlpacaAdapter,   // Alpaca supports crypto via the same /v2/orders endpoint
  futures: FuturesAdapterStub,
  forex:   ForexAdapterStub,
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
