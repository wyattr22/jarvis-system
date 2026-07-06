"use client"

// Shadow vs live panel (12.7). Two-series cumulative-R line chart —
// palette validated on the dark surface: shadow #3d87e0, live #00a37d.
// Direct labels + legend; hover shows values (never color-alone).

import { useEffect, useState } from "react"

type Curve = { t: number; shadowR: number; liveR: number }
type Side = { count: number; wins: number; totalR: number; winRate: number }
type Comparison = {
  days: number
  shadow: Side
  live: Side
  missedR: number
  curve: Curve[]
  signals: { id: string; instrument: string; direction: string; executed: boolean; shadow_r: number | null; live_r: number | null; shadow_exit: string | null; created_at: number }[]
}

const SHADOW = "#3d87e0"
const LIVE = "#00a37d"

function CurveChart({ curve }: { curve: Curve[] }) {
  if (curve.length < 2) return null
  const W = 640, H = 180, PAD = 28
  const ts = curve.map(c => c.t)
  const vals = curve.flatMap(c => [c.shadowR, c.liveR])
  const tMin = Math.min(...ts), tMax = Math.max(...ts)
  const vMin = Math.min(0, ...vals), vMax = Math.max(0.5, ...vals)
  const x = (t: number) => PAD + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - 2 * PAD)
  const y = (v: number) => H - PAD - ((v - vMin) / Math.max(0.001, vMax - vMin)) * (H - 2 * PAD)
  const path = (key: "shadowR" | "liveR") => curve.map((c, i) => `${i === 0 ? "M" : "L"}${x(c.t).toFixed(1)},${y(c[key]).toFixed(1)}`).join(" ")
  const last = curve[curve.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cumulative R: shadow vs live">
      {/* zero line */}
      <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="#1f2937" strokeWidth={1} />
      <path d={path("shadowR")} fill="none" stroke={SHADOW} strokeWidth={2} />
      <path d={path("liveR")} fill="none" stroke={LIVE} strokeWidth={2} />
      {/* direct labels at line ends */}
      <text x={W - PAD + 4} y={y(last.shadowR) + 3} fontSize={10} fill={SHADOW}>{last.shadowR}R</text>
      <text x={W - PAD + 4} y={y(last.liveR) + 3} fontSize={10} fill={LIVE}>{last.liveR}R</text>
    </svg>
  )
}

export function ShadowComparison() {
  const [data, setData] = useState<Comparison | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analysis/shadow?days=${days}`)
      .then(r => r.json())
      .then(d => setData(d.error ? null : d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <div className="border border-border rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground tracking-widest">SHADOW VS LIVE</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            <span style={{ color: SHADOW }}>■ shadow</span> = every signal simulated against real bars ·{" "}
            <span style={{ color: LIVE }}>■ live</span> = executed trades only ·
            the gap is what the filters saved or left on the table
          </p>
        </div>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="text-[10px] tracking-widest bg-secondary border border-border rounded px-2 py-1 text-foreground"
        >
          {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d}D</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground tracking-widest py-6 text-center">SIMULATING…</p>
      ) : !data || data.curve.length < 2 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          Not enough signals in the window yet — the comparison fills up as the signal engine runs.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
            <Stat label="SHADOW R" value={`${data.shadow.totalR > 0 ? "+" : ""}${data.shadow.totalR}R`} color={SHADOW} />
            <Stat label="LIVE R" value={`${data.live.totalR > 0 ? "+" : ""}${data.live.totalR}R`} color={LIVE} />
            <Stat label="SHADOW WIN%" value={`${(data.shadow.winRate * 100).toFixed(0)}%`} sub={`${data.shadow.wins}/${data.shadow.count}`} />
            <Stat label="LIVE WIN%" value={`${(data.live.winRate * 100).toFixed(0)}%`} sub={`${data.live.wins}/${data.live.count}`} />
            <Stat
              label="UNEXECUTED R"
              value={`${data.missedR > 0 ? "+" : ""}${data.missedR}R`}
              sub={data.missedR > 0 ? "left on the table" : "filters saved this"}
            />
          </div>
          <CurveChart curve={data.curve} />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="border border-border rounded p-2">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className="text-sm font-semibold mt-0.5" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground">{sub}</p>}
    </div>
  )
}
