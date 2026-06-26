"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

type DriftEntry = {
  strategy_id: string
  window_start: number
  window_end: number
  expected_r: number
  actual_r: number
  divergence_sigma: number
  auto_paused: number
}

type Trade = {
  strategy_id: string
  r_multiple: number
  opened_at: number
}

type Strategy = { id: string; name: string }

export default function DriftPage() {
  const [driftLog, setDriftLog] = useState<DriftEntry[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [strategyId, setStrategyId] = useState<string | "">("")
  const [loading, setLoading] = useState(true)

  async function load(sid: string) {
    setLoading(true)
    try {
      const url = sid ? `/api/drift/history?strategyId=${sid}` : "/api/drift/history"
      const res = await fetch(url)
      const json = await res.json()
      setDriftLog(json.driftLog ?? [])
      setTrades(json.trades ?? [])
      setStrategies(json.strategies ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(strategyId) }, [strategyId])

  // Compute cumulative R curve grouped by strategy
  const tradesByStrategy = trades.reduce<Record<string, Trade[]>>((acc, t) => {
    acc[t.strategy_id] = [...(acc[t.strategy_id] ?? []), t]
    return acc
  }, {})

  // Latest drift status per strategy
  const latestDrift = Object.values(
    driftLog.reduce<Record<string, DriftEntry>>((acc, d) => {
      if (!acc[d.strategy_id] || d.window_start > acc[d.strategy_id].window_start) {
        acc[d.strategy_id] = d
      }
      return acc
    }, {})
  )

  const empty = driftLog.length === 0 && trades.length === 0

  return (
    <div className="p-6 space-y-6">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Drift Monitor</h1>
          <p className="text-xs text-muted-foreground mt-1">Live vs backtest divergence · auto-pause at 2σ</p>
        </div>
        {strategies.length > 0 && (
          <select
            value={strategyId}
            onChange={e => setStrategyId(e.target.value)}
            className="text-[10px] tracking-widest bg-secondary border border-border rounded px-2 py-1 text-foreground"
          >
            <option value="">ALL STRATEGIES</option>
            {strategies.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : empty ? (
        <div className="flex items-center justify-center h-64 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
          NO DRIFT DATA — requires 20+ trades with R multiples
        </div>
      ) : (
        <>
          {/* Current drift status */}
          {latestDrift.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">CURRENT STATUS</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {latestDrift.map(d => (
                  <DriftCard key={d.strategy_id} drift={d} />
                ))}
              </div>
            </div>
          )}

          {/* Cumulative R per strategy */}
          {Object.entries(tradesByStrategy).map(([sid, sidTrades]) => {
            const sorted = [...sidTrades].sort((a, b) => a.opened_at - b.opened_at)
            let cumR = 0
            const curve = sorted.map(t => {
              cumR += t.r_multiple
              return { r: cumR, date: new Date(t.opened_at).toLocaleDateString() }
            })

            const min = Math.min(...curve.map(c => c.r))
            const max = Math.max(...curve.map(c => c.r))
            const range = max - min || 1
            const h = 60
            const w = 100

            const points = curve.map((c, i) => {
              const x = (i / Math.max(curve.length - 1, 1)) * w
              const y = h - ((c.r - min) / range) * h
              return `${x},${y}`
            }).join(" ")

            const stratName = strategies.find(s => s.id === sid)?.name ?? sid

            return (
              <div key={sid}>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
                  {stratName.toUpperCase()} — CUMULATIVE R
                </p>
                <div className="border border-border rounded p-4 bg-secondary/20">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground">{sorted.length} trades</span>
                    <span className={`text-sm font-medium ${cumR >= 0 ? "text-primary" : "text-red-400"}`}>
                      {cumR >= 0 ? "+" : ""}{cumR.toFixed(2)}R
                    </span>
                  </div>
                  {curve.length > 1 && (
                    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
                      <polyline
                        points={points}
                        fill="none"
                        stroke={cumR >= 0 ? "#00d4a1" : "#ef4444"}
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                      />
                      <line x1="0" y1={h - ((0 - min) / range) * h} x2={w} y2={h - ((0 - min) / range) * h}
                        stroke="#1e2d40" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                    </svg>
                  )}
                </div>
              </div>
            )
          })}

          {/* Drift log table */}
          {driftLog.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">DRIFT LOG</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-muted-foreground tracking-widest border-b border-border">
                      <th className="text-left pb-2">STRATEGY</th>
                      <th className="text-right pb-2">σ</th>
                      <th className="text-right pb-2">LIVE R</th>
                      <th className="text-right pb-2">BACKTEST R</th>
                      <th className="text-right pb-2">N</th>
                      <th className="text-left pb-2 pl-3">ACTION</th>
                      <th className="text-right pb-2">TIME</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {driftLog.slice(0, 50).map((d, i) => (
                      <tr key={i}>
                        <td className="py-1.5 text-muted-foreground">{d.strategy_id}</td>
                        <td className={`py-1.5 text-right font-medium ${
                          Math.abs(d.divergence_sigma) > 2 ? "text-red-400" :
                          Math.abs(d.divergence_sigma) > 1.5 ? "text-yellow-400" : "text-foreground"
                        }`}>
                          {d.divergence_sigma.toFixed(2)}
                        </td>
                        <td className={`py-1.5 text-right ${d.actual_r >= 0 ? "text-primary" : "text-red-400"}`}>
                          {d.actual_r.toFixed(3)}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">{d.expected_r.toFixed(3)}</td>
                        <td className="py-1.5 text-right text-muted-foreground">—</td>
                        <td className={`py-1.5 pl-3 ${d.auto_paused ? "text-red-400" : "text-muted-foreground"}`}>
                          {d.auto_paused ? "AUTO-PAUSED" : "MONITORING"}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground text-[10px]">
                          {new Date(d.window_start).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DriftCard({ drift }: { drift: DriftEntry }) {
  const sigma = Math.abs(drift.divergence_sigma)
  const breached = sigma > 2
  const warning = sigma > 1.5

  return (
    <div className={`border rounded p-3 ${
      breached ? "border-red-400/30 bg-red-400/5" :
      warning ? "border-yellow-400/30 bg-yellow-400/5" :
      "border-border bg-secondary/20"
    }`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-foreground truncate">{drift.strategy_id}</p>
        <Badge variant="outline" className={`text-[9px] ${
          drift.auto_paused ? "text-red-400 border-red-400/30" :
          breached ? "text-yellow-400 border-yellow-400/30" :
          "text-primary border-primary/30"
        }`}>
          {drift.auto_paused ? "PAUSED" : breached ? "ALERT" : "OK"}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[9px] text-muted-foreground">σ</p>
          <p className={`text-sm font-medium ${breached ? "text-red-400" : warning ? "text-yellow-400" : "text-foreground"}`}>
            {drift.divergence_sigma.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground">ACTUAL</p>
          <p className={`text-sm font-medium ${drift.actual_r >= 0 ? "text-primary" : "text-red-400"}`}>
            {drift.actual_r.toFixed(2)}R
          </p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground">EXPECTED</p>
          <p className="text-sm font-medium text-muted-foreground">{drift.expected_r.toFixed(2)}R</p>
        </div>
      </div>
    </div>
  )
}
