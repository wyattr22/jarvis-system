// /markets — the full-visibility cockpit (Phase 11.7).
// Server component; each section streams independently behind Suspense so a
// slow or dead provider degrades one panel, never the page.

import { Suspense } from "react"
import { ChartModal } from "@/components/chart-modal"
import { IndexTiles } from "./sections/index-tiles"
import { FuturesStrip } from "./sections/futures-strip"
import { ForexGrid } from "./sections/forex-grid"
import { MacroRow } from "./sections/macro-row"
import { SectorHeatmap } from "./sections/sector-heatmap"
import { Movers } from "./sections/movers"
import { OptionsPulse } from "./sections/options-pulse"

export const dynamic = "force-dynamic"

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 11, letterSpacing: "0.15em", color: "#9ca3af", marginBottom: 10, fontWeight: 600 }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Skeleton({ height = 72 }: { height?: number }) {
  return (
    <div
      style={{
        height,
        background: "#0d131c",
        border: "1px solid #1f2937",
        borderRadius: 8,
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  )
}

export default function MarketsPage() {
  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <ChartModal />
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Markets</h1>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Complete market visibility — every price carries an honest freshness badge.
        Click any tile for its TradingView chart. Futures and indexes are delayed
        (no free real-time CME/index data exists); each future is paired with its
        real-time ETF proxy.
      </p>

      <Panel title="INDEXES">
        <Suspense fallback={<Skeleton />}>
          <IndexTiles />
        </Suspense>
      </Panel>

      <Panel title="FUTURES · DELAYED, WITH LIVE ETF PROXY">
        <Suspense fallback={<Skeleton height={120} />}>
          <FuturesStrip />
        </Suspense>
      </Panel>

      <Panel title="FOREX MAJORS">
        <Suspense fallback={<Skeleton />}>
          <ForexGrid />
        </Suspense>
      </Panel>

      <Panel title="MACRO">
        <Suspense fallback={<Skeleton height={56} />}>
          <MacroRow />
        </Suspense>
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <Panel title="SECTORS · TODAY %">
          <Suspense fallback={<Skeleton height={160} />}>
            <SectorHeatmap />
          </Suspense>
        </Panel>
        <Panel title="OPTIONS PULSE">
          <Suspense fallback={<Skeleton height={160} />}>
            <OptionsPulse />
          </Suspense>
        </Panel>
      </div>

      <Panel title="TOP MOVERS · WHOLE MARKET (INCL. SMALL CAPS)">
        <Suspense fallback={<Skeleton height={220} />}>
          <Movers />
        </Suspense>
      </Panel>
    </div>
  )
}
