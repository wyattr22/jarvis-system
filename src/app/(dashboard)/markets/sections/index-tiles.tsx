import { getIndexQuotes } from "@/lib/data/indexes"
import { INDEX_CATALOG } from "@/lib/data/indexes"
import { FreshnessBadge } from "@/components/ui/freshness-badge"
import { ChartTile } from "@/components/chart-modal"
import { changeColor, fmtPct, fmtPrice, tileStyle, ErrorNote } from "./shared"

export async function IndexTiles() {
  const quotes = await getIndexQuotes()
  if (!quotes.length) return <ErrorNote what="Index data" />
  const labels = new Map(INDEX_CATALOG.map(i => [i.symbol, i.label]))
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {quotes.map(q => (
        <ChartTile key={q.symbol} symbol={q.symbol}>
          <div style={tileStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{labels.get(q.symbol) ?? q.symbol}</span>
              <FreshnessBadge meta={q.meta} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>{fmtPrice(q.price)}</div>
            <div style={{ fontSize: 12, color: changeColor(q.changePct) }}>{fmtPct(q.changePct)}</div>
          </div>
        </ChartTile>
      ))}
    </div>
  )
}
