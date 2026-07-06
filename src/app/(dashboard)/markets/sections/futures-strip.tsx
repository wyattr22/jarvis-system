// Each cell: the delayed continuous contract AND its real-time ETF proxy.
// This pairing IS the product decision — see DECISIONS.md 2026-07-05.

import { getFuturesQuotes } from "@/lib/data/futures"
import { getMarketQuotes } from "@/lib/data/alpaca"
import { FUTURES_CATALOG } from "@/lib/instruments/proxies"
import { FreshnessBadge } from "@/components/ui/freshness-badge"
import { changeColor, fmtPct, fmtPrice, tileStyle, ErrorNote } from "./shared"

export async function FuturesStrip() {
  const proxySymbols = FUTURES_CATALOG.map(f => f.proxy).filter((p): p is string => p !== null)
  const [futures, proxies] = await Promise.all([
    getFuturesQuotes(),
    getMarketQuotes(proxySymbols).catch(() => []),
  ])
  if (!futures.length) return <ErrorNote what="Futures data" />

  const futureBySymbol = new Map(futures.map(q => [q.symbol, q]))
  const proxyBySymbol = new Map(proxies.map(q => [q.symbol, q]))

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {FUTURES_CATALOG.map(spec => {
        const fut = futureBySymbol.get(spec.future)
        if (!fut) return null
        const proxy = spec.proxy ? proxyBySymbol.get(spec.proxy) : undefined
        return (
          <div key={spec.future} style={{ ...tileStyle, minWidth: 168 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{spec.label}</span>
              <FreshnessBadge meta={fut.meta} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
              {fmtPrice(fut.price)}{" "}
              <span style={{ fontSize: 12, color: changeColor(fut.changePct) }}>{fmtPct(fut.changePct)}</span>
            </div>
            {proxy && proxy.price > 0 && (
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6, borderTop: "1px solid #1f2937", paddingTop: 6 }}>
                {spec.proxy} {fmtPrice(proxy.price)}{" "}
                <span style={{ color: changeColor(proxy.changePct) }}>{fmtPct(proxy.changePct)}</span>{" "}
                <FreshnessBadge meta={proxy.meta} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
