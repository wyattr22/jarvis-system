"use client"

import { useEffect, useState } from "react"

type Summary = {
  total_trades: number
  wins: number
  losses: number
  win_rate: number
  total_pnl: number
  avg_r: number
  std_dev_r: number
  sharpe_annualised: number
  max_drawdown_usd: number
}

type DailyPoint = { day: string; daily_pnl: number; cumulative_pnl: number }

type ApiResponse = {
  ok: boolean
  days_back: number
  summary: Summary | null
  daily: DailyPoint[]
  message?: string
}

export default function PerformancePage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [days, setDays] = useState(90)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/performance?days=${days}`)
      .then(r => r.json())
      .then((d: ApiResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Performance</h1>
      <p style={{ color: "#9ca3af", marginBottom: 16 }}>
        Rolled-up trade stats from the trades table. Window: last
        <select value={days} onChange={e => setDays(Number(e.target.value))}
                style={{ background: "#0f1923", color: "#e5e7eb", border: "1px solid #1f2937", padding: "2px 8px", borderRadius: 4, marginLeft: 8 }}>
          <option value={7}>7</option>
          <option value={30}>30</option>
          <option value={90}>90</option>
          <option value={180}>180</option>
          <option value={365}>365</option>
        </select> days.
      </p>

      {loading && <div style={{ color: "#9ca3af" }}>Loading…</div>}

      {!loading && data && data.message && (
        <div style={{ color: "#9ca3af", padding: 32, textAlign: "center" }}>{data.message}</div>
      )}

      {!loading && data && data.summary && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
            <Tile label="Trades" value={String(data.summary.total_trades)} sub={`${data.summary.wins}W ${data.summary.losses}L`} />
            <Tile label="Win Rate" value={`${(data.summary.win_rate * 100).toFixed(1)}%`} color={data.summary.win_rate >= 0.5 ? "#00d4a1" : "#f5c518"} />
            <Tile label="Total P&L" value={`$${data.summary.total_pnl.toFixed(0)}`} color={data.summary.total_pnl >= 0 ? "#00d4a1" : "#ff5c5c"} />
            <Tile label="Avg R" value={data.summary.avg_r.toFixed(2)} color={data.summary.avg_r >= 0 ? "#00d4a1" : "#ff5c5c"} />
            <Tile label="R Std Dev" value={data.summary.std_dev_r.toFixed(2)} />
            <Tile label="Sharpe (ann)" value={data.summary.sharpe_annualised.toFixed(2)} color={data.summary.sharpe_annualised >= 1 ? "#00d4a1" : data.summary.sharpe_annualised >= 0 ? "#f5c518" : "#ff5c5c"} />
            <Tile label="Max Drawdown" value={`$${data.summary.max_drawdown_usd.toFixed(0)}`} color="#ff5c5c" />
          </div>

          {data.daily.length > 0 && (
            <EquityChart points={data.daily} />
          )}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#0f1923", padding: 16, borderRadius: 6, border: "1px solid #1f2937" }}>
      <div style={{ fontSize: 11, color: "#9ca3af", letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color ?? "#e5e7eb", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function EquityChart({ points }: { points: DailyPoint[] }) {
  if (points.length < 2) return null
  const width = 900, height = 240, pad = 30
  const max = Math.max(...points.map(p => p.cumulative_pnl))
  const min = Math.min(...points.map(p => p.cumulative_pnl), 0)
  const range = Math.max(1e-9, max - min)
  const xStep = (width - 2 * pad) / Math.max(1, points.length - 1)
  const yOf = (v: number) => height - pad - ((v - min) / range) * (height - 2 * pad)
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${pad + i * xStep} ${yOf(p.cumulative_pnl)}`).join(" ")
  const zeroY = yOf(0)
  return (
    <div style={{ background: "#0f1923", border: "1px solid #1f2937", borderRadius: 6, padding: 16 }}>
      <h3 style={{ fontSize: 12, color: "#9ca3af", letterSpacing: 0.5, marginBottom: 12 }}>EQUITY CURVE — CUMULATIVE P&L</h3>
      <svg width={width} height={height} style={{ display: "block", maxWidth: "100%" }}>
        <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="#1f2937" strokeDasharray="2 4" />
        <path d={path} stroke="#00d4a1" strokeWidth={2} fill="none" />
        <text x={pad} y={pad - 10} fill="#9ca3af" fontSize={10}>${max.toFixed(0)}</text>
        <text x={pad} y={height - 8} fill="#9ca3af" fontSize={10}>${min.toFixed(0)}</text>
        <text x={pad} y={zeroY - 4} fill="#6b7280" fontSize={9}>$0</text>
      </svg>
    </div>
  )
}
