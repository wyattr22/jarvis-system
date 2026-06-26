"use client"

import { useEffect, useState } from "react"

type FeatureRow = { name: string; value: number }

const FEATURE_GROUPS: Record<string, string[]> = {
  "VOLATILITY": ["atr_14", "atr_ratio", "parkinson", "garman_klass", "realized_vol_5", "realized_vol_20"],
  "TREND": ["sma20_dist", "sma50_dist", "ema_cross", "adx_14", "reg_slope_10", "reg_slope_20", "trend_persistence"],
  "MOMENTUM": ["rsi_7", "rsi_14", "rsi_21", "roc_5", "roc_10", "roc_20", "macd", "macd_signal", "macd_hist", "stoch_k", "stoch_d", "williams_r"],
  "SMC STRUCTURE": ["swing_high_dist", "swing_low_dist", "session_high_dist", "session_low_dist", "fvg_age", "bos_distance", "equal_highs_proximity", "prior_day_range", "prior_day_range_atr_ratio", "htf_structure", "daily_momentum"],
  "VOLUME": ["rel_volume", "vwap_dist", "vol_ratio_hl"],
  "TIME / SESSION": ["hour_of_session", "day_of_week", "in_kill_zone"],
}

function getColor(name: string, value: number): string {
  // RSI
  if (name.startsWith("rsi")) {
    if (value > 70) return "text-red-400"
    if (value < 30) return "text-primary"
    return "text-foreground"
  }
  // Distance (negative = below, positive = above)
  if (name.includes("dist")) {
    if (value > 0.02) return "text-primary"
    if (value < -0.02) return "text-red-400"
    return "text-yellow-400"
  }
  // ADX
  if (name === "adx_14") {
    if (value > 25) return "text-primary"
    return "text-muted-foreground"
  }
  // Kill zone
  if (name === "in_kill_zone") return value > 0 ? "text-primary" : "text-muted-foreground"
  return "text-foreground"
}

function formatValue(name: string, value: number): string {
  if (name.startsWith("rsi") || name.startsWith("stoch") || name === "williams_r") {
    return value.toFixed(1)
  }
  if (name.includes("dist") || name.includes("vol") || name.includes("slope")) {
    return value.toFixed(4)
  }
  if (name === "in_kill_zone" || name === "day_of_week") {
    return value.toFixed(0)
  }
  return value.toFixed(3)
}

export default function FeatureLibraryPage() {
  const [instrument, setInstrument] = useState("TSLA")
  const [instruments, setInstruments] = useState<string[]>([])
  const [features, setFeatures] = useState<FeatureRow[]>([])
  const [timestamp, setTimestamp] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  async function load(inst: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/features-data?instrument=${inst}`)
      const json = await res.json()
      setFeatures(json.features ?? [])
      setTimestamp(json.timestamp)
      setInstruments(json.instruments ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(instrument) }, [instrument])

  const featureMap = Object.fromEntries(features.map(f => [f.name, f.value]))
  const filtered = features.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))

  const empty = features.length === 0 && !loading

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Feature Library</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {timestamp
              ? `Latest snapshot · ${new Date(timestamp).toLocaleString()}`
              : "50+ engineered features · run /api/features/compute to populate"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {instruments.length > 0 && (
            <select
              value={instrument}
              onChange={e => setInstrument(e.target.value)}
              className="text-[10px] tracking-widest bg-secondary border border-border rounded px-2 py-1 text-foreground"
            >
              {instruments.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          )}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search..."
            className="text-[10px] bg-secondary border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground w-32"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : empty ? (
        <div className="flex items-center justify-center h-64 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
          NO FEATURE DATA — trigger /api/features/compute first
        </div>
      ) : search ? (
        <div className="space-y-1">
          {filtered.map(f => (
            <FeatureRow key={f.name} name={f.name} value={f.value} />
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground tracking-widest text-center py-8">NO MATCHES</p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(FEATURE_GROUPS).map(([group, names]) => {
            const groupFeatures = names
              .filter(n => featureMap[n] !== undefined)
              .map(n => ({ name: n, value: featureMap[n] }))
            if (groupFeatures.length === 0) return null
            return (
              <div key={group}>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-2">{group}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {groupFeatures.map(f => (
                    <FeatureCard key={f.name} name={f.name} value={f.value} />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Unknown features not in any group */}
          {(() => {
            const known = new Set(Object.values(FEATURE_GROUPS).flat())
            const unknown = features.filter(f => !known.has(f.name))
            if (!unknown.length) return null
            return (
              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-2">OTHER</p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {unknown.map(f => <FeatureCard key={f.name} name={f.name} value={f.value} />)}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function FeatureCard({ name, value }: { name: string; value: number }) {
  const color = getColor(name, value)
  return (
    <div className="bg-secondary border border-border rounded p-2">
      <p className="text-[9px] text-muted-foreground tracking-widest truncate">{name}</p>
      <p className={`text-sm font-medium mt-0.5 ${color}`}>{formatValue(name, value)}</p>
    </div>
  )
}

function FeatureRow({ name, value }: { name: string; value: number }) {
  const color = getColor(name, value)
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-secondary/50">
      <span className="text-xs text-muted-foreground">{name}</span>
      <span className={`text-xs font-medium ${color}`}>{formatValue(name, value)}</span>
    </div>
  )
}
