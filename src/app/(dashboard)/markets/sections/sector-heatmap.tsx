// Diverging heatmap: two poles + neutral midpoint per the dataviz color
// formula (validated pair on the dark surface). Every cell carries its signed
// % as text — polarity is never color-alone.

import { getSectorETFs } from "@/lib/data/alpaca"
import { ChartTile } from "@/components/chart-modal"
import { ErrorNote } from "./shared"

const SECTOR_LABELS: Record<string, string> = {
  SPY: "S&P 500",
  XLK: "Tech",
  XLF: "Financials",
  XLE: "Energy",
  XLV: "Health",
  XLI: "Industrials",
  XLY: "Cons. Disc",
  XLC: "Comms",
  XLP: "Staples",
  XLU: "Utilities",
  XLRE: "Real Estate",
  XLB: "Materials",
}

// Exported for tests: alpha-scaled fill between the validated poles.
// |pct| >= 2% saturates; 0 is the neutral surface.
export function heatCellStyle(pct: number): { background: string; color: string } {
  const capped = Math.max(-2, Math.min(2, pct))
  const alpha = Math.abs(capped) / 2
  if (alpha < 0.05) return { background: "var(--muted)", color: "#e5e7eb" }
  const pole = capped > 0 ? "0, 163, 125" : "230, 69, 69" // #00a37d / #e64545
  return {
    background: `rgba(${pole}, ${(0.15 + 0.5 * alpha).toFixed(2)})`,
    color: "#f3f4f6",
  }
}

export async function SectorHeatmap() {
  const sectors = await getSectorETFs()
  const entries = Object.entries(sectors)
  if (!entries.length) return <ErrorNote what="Sector data" />
  entries.sort((a, b) => b[1] - a[1])
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
      {entries.map(([etf, pct]) => {
        const s = heatCellStyle(pct)
        return (
          <ChartTile key={etf} symbol={etf}>
            <div
              title={`${etf} ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% today`}
              style={{ ...s, borderRadius: 4, padding: "10px 8px", textAlign: "center" }}
            >
              <div style={{ fontSize: 10, opacity: 0.85 }}>{SECTOR_LABELS[etf] ?? etf}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</div>
            </div>
          </ChartTile>
        )
      })}
    </div>
  )
}
