import { getOptionsSnapshot } from "@/lib/data/options"
import { FreshnessBadge } from "@/components/ui/freshness-badge"
import { UP, DOWN, NEUTRAL, tileStyle, ErrorNote } from "./shared"

function PulseCard({ symbol, snap }: {
  symbol: string
  snap: NonNullable<Awaited<ReturnType<typeof getOptionsSnapshot>>>
}) {
  const gexB = snap.gex / 1e9
  const pcColor = snap.pcRatio > 1.2 ? DOWN : snap.pcRatio < 0.8 ? UP : NEUTRAL
  return (
    <div style={{ ...tileStyle, flex: 1, minWidth: 200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 13 }}>{symbol}</b>
        <FreshnessBadge meta={snap.meta} />
      </div>
      <div style={{ fontSize: 12, marginTop: 8, display: "grid", gap: 4 }}>
        <div><span style={{ color: "#9ca3af" }}>Max pain</span> <b>${snap.maxPain}</b> <span style={{ color: "#6b7280" }}>(spot ${snap.spot.toFixed(2)})</span></div>
        <div><span style={{ color: "#9ca3af" }}>P/C ratio</span> <b style={{ color: pcColor }}>{snap.pcRatio.toFixed(2)}</b></div>
        <div>
          <span style={{ color: "#9ca3af" }}>GEX</span>{" "}
          <b style={{ color: gexB > 0 ? UP : DOWN }}>{gexB >= 0 ? "+" : ""}{gexB.toFixed(2)}B</b>{" "}
          <span style={{ color: "#6b7280" }}>{gexB > 0 ? "pinning" : "trending"}</span>
        </div>
        <div style={{ color: "#9ca3af" }}>
          Call walls: {snap.callWalls.map(w => `$${w.strike}`).join(" ")}
          {" · "}Put walls: {snap.putWalls.map(w => `$${w.strike}`).join(" ")}
        </div>
      </div>
    </div>
  )
}

export async function OptionsPulse() {
  const [spy, qqq] = await Promise.all([
    getOptionsSnapshot("SPY"),
    getOptionsSnapshot("QQQ"),
  ])
  if (!spy && !qqq) return <ErrorNote what="Options positioning" />
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {spy && <PulseCard symbol="SPY" snap={spy} />}
      {qqq && <PulseCard symbol="QQQ" snap={qqq} />}
    </div>
  )
}
