// Human-readable rendering of parsed instruments for dashboards.

import type { ParsedInstrument } from "./parse"
import { FUTURES_CATALOG } from "./proxies"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function formatInstrument(p: ParsedInstrument): string {
  switch (p.assetClass) {
    case "options": {
      if (!p.expiry || p.strike === undefined || !p.right) return p.raw
      const [y, m, d] = p.expiry.split("-").map(Number)
      const month = MONTHS[(m ?? 1) - 1] ?? ""
      const strike = p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike.toString()
      const kind = p.right === "C" ? "Call" : "Put"
      return `${p.underlying} ${d} ${month} '${String(y).slice(2)} $${strike} ${kind}`
    }
    case "futures": {
      const spec = FUTURES_CATALOG.find(f => f.root === p.underlying)
      const label = spec?.label ?? p.underlying
      if (p.expiry) {
        const [y, m] = p.expiry.split("-").map(Number)
        return `${label} ${MONTHS[(m ?? 1) - 1]} '${String(y).slice(2)}`
      }
      return `${label} (cont.)`
    }
    case "forex":
      return p.underlying
    default:
      return p.raw
  }
}
