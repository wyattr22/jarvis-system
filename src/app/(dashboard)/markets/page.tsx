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
    <section className="mb-7">
      <h2 className="text-[10px] tracking-[0.15em] text-muted-foreground font-medium mb-2.5">{title}</h2>
      {children}
    </section>
  )
}

function Skeleton({ height = 72 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded border"
      style={{ height, background: "var(--card)" }}
    />
  )
}

export default function MarketsPage() {
  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <ChartModal />
      <div className="border-b pb-4 mb-6">
        <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Markets</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Every price wears an honest freshness badge · click any tile to open its chart ·
          futures and indexes are delayed (no free real-time feed exists), each paired with a live ETF proxy
        </p>
      </div>

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
