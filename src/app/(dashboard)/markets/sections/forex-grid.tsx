// Forex majors (activated in 11.3). Free-tier probe: Finnhub paywalls ALL
// forex endpoints now, so the grid quotes Yahoo `PAIR=X` — honestly badged
// DELAYED. If a real-time free forex source appears (e.g. Oanda practice via
// the deferred Oanda step), swap the fetcher; the layout stays.

import { getYahooQuotes } from "@/lib/data/yahoo"
import { FreshnessBadge } from "@/components/ui/freshness-badge"
import { ChartTile } from "@/components/chart-modal"
import { changeColor, fmtPct, tileStyle, ErrorNote } from "./shared"

const MAJORS: { pair: string; yahoo: string }[] = [
  { pair: "EUR/USD", yahoo: "EURUSD=X" },
  { pair: "USD/JPY", yahoo: "USDJPY=X" },
  { pair: "GBP/USD", yahoo: "GBPUSD=X" },
  { pair: "USD/CHF", yahoo: "USDCHF=X" },
  { pair: "AUD/USD", yahoo: "AUDUSD=X" },
  { pair: "USD/CAD", yahoo: "USDCAD=X" },
  { pair: "NZD/USD", yahoo: "NZDUSD=X" },
  { pair: "EUR/GBP", yahoo: "EURGBP=X" },
]

export async function ForexGrid() {
  const quotes = await getYahooQuotes(MAJORS.map(m => m.yahoo), "yahoo.forex", 60)
  if (!quotes.length) return <ErrorNote what="Forex data" />
  const bySymbol = new Map(quotes.map(q => [q.symbol, q]))
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {MAJORS.map(({ pair, yahoo }) => {
        const q = bySymbol.get(yahoo)
        if (!q) return null
        const digits = q.price >= 20 ? 2 : 4
        return (
          <ChartTile key={pair} symbol={yahoo}>
            <div style={{ ...tileStyle, minWidth: 120 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#9ca3af" }}>{pair}</span>
                <FreshnessBadge meta={q.meta} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{q.price.toFixed(digits)}</div>
              <div style={{ fontSize: 12, color: changeColor(q.changePct) }}>{fmtPct(q.changePct)}</div>
            </div>
          </ChartTile>
        )
      })}
    </div>
  )
}
