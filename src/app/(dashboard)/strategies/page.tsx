"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

type Strategy = {
  id: string
  name: string
  description: string | null
  enabled: number
  weight: number
  capital_tier: number
  config_json: string | null
  created_at: number
  signal_count: number
  trade_count: number
  avg_r: number | null
  win_rate: number | null
}

// Tier 0 = shadow (Phase 18): generates signals/opportunities for
// observation only — auto-cycle's shadow-tier gate blocks it from ever
// reaching a broker, regardless of what the allocator/risk-manager approved.
// Every new strategy (human- or LLM-authored) starts here until promoted.
const TIER_LABEL = ["SHADOW", "1% PAPER", "5% LIVE", "FULL SIZE"]

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Strategy | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/strategies")
      const json = await res.json()
      setStrategies(json.strategies ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Strategies</h1>
          <p className="text-xs text-muted-foreground mt-1">Registry · capital tiers · performance</p>
        </div>
        <button
          onClick={load}
          className="text-[10px] tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
        >
          REFRESH
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : strategies.length === 0 ? (
        <div className="flex items-center justify-center h-64 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
          NO STRATEGIES — run seed script
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            {strategies.map(s => (
              <button
                key={s.id}
                onClick={() => setSelected(selected?.id === s.id ? null : s)}
                className={`w-full text-left p-3 rounded border transition-colors ${
                  selected?.id === s.id
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:border-primary/20 hover:bg-secondary/30"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">{s.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[9px] ${s.enabled ? "text-primary border-primary/30" : "text-yellow-400 border-yellow-400/30"}`}>
                      {s.enabled ? "ACTIVE" : "PAUSED"}
                    </Badge>
                    <span className={`text-[9px] border rounded px-1 ${
                      s.capital_tier === 0
                        ? "text-red-400 border-red-400/30"
                        : "text-muted-foreground border-border"
                    }`}>
                      {TIER_LABEL[s.capital_tier] ?? `TIER ${s.capital_tier}`}
                    </span>
                  </div>
                </div>

                {s.description && (
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{s.description}</p>
                )}

                <div className="flex items-center gap-4 mt-2 text-[10px]">
                  <span className="text-muted-foreground">{s.trade_count} trades</span>
                  {s.avg_r !== null && (
                    <span className={s.avg_r >= 0 ? "text-primary" : "text-red-400"}>
                      {s.avg_r >= 0 ? "+" : ""}{s.avg_r.toFixed(3)} avg R
                    </span>
                  )}
                  {s.win_rate !== null && (
                    <span className="text-muted-foreground">
                      {(s.win_rate * 100).toFixed(0)}% WR
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="border border-border rounded p-4 space-y-4">
              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-1">STRATEGY</p>
                <p className="text-sm font-medium">{selected.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{selected.id}</p>
              </div>

              {selected.description && (
                <div>
                  <p className="text-[10px] text-muted-foreground tracking-widest mb-1">DESCRIPTION</p>
                  <p className="text-xs leading-relaxed">{selected.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="CAPITAL TIER" value={TIER_LABEL[selected.capital_tier] ?? `TIER ${selected.capital_tier}`} />
                <MiniStat label="STATUS" value={selected.enabled ? "ACTIVE" : "PAUSED"} />
                <MiniStat label="SIGNALS" value={selected.signal_count} />
                <MiniStat label="TRADES" value={selected.trade_count} />
                {selected.avg_r !== null && (
                  <MiniStat label="AVG R" value={`${selected.avg_r >= 0 ? "+" : ""}${selected.avg_r.toFixed(3)}`} />
                )}
                {selected.win_rate !== null && (
                  <MiniStat label="WIN RATE" value={`${(selected.win_rate * 100).toFixed(1)}%`} />
                )}
              </div>

              {selected.config_json && (() => {
                try {
                  const cfg = JSON.parse(selected.config_json)
                  return (
                    <div>
                      <p className="text-[10px] text-muted-foreground tracking-widest mb-1">CONFIG</p>
                      <pre className="text-[10px] text-muted-foreground font-mono bg-secondary rounded p-2 overflow-x-auto">
                        {JSON.stringify(cfg, null, 2)}
                      </pre>
                    </div>
                  )
                } catch { return null }
              })()}

              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-1">CAPITAL TIER GATES</p>
                <div className="space-y-1 text-[10px]">
                  <p className="text-muted-foreground">Tier 0 (shadow): signals generate for observation only — auto-cycle blocks execution regardless of allocator/risk-manager approval</p>
                  <p className="text-muted-foreground">Tier 1→2: 30 profitable trades + 60 days paper</p>
                  <p className="text-muted-foreground">Tier 2→3: 90 profitable trades + Sharpe &gt; 1.0</p>
                  <p className="text-muted-foreground">All council proposals require 50 shadow trades + p &lt; 0.05</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-secondary border border-border rounded p-2">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className="text-xs font-medium text-foreground mt-0.5">{String(value)}</p>
    </div>
  )
}
