"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

type Trade = {
  r_multiple: number
  pnl: number | null
  opened_at: number
  closed_at: number | null
  regime_tag: string | null
  instrument: string
  direction: string
}

type Strategy = { id: string; name: string }

type WalkForwardResult = {
  windows: Array<{
    trainStart: number; trainEnd: number
    testStart: number; testEnd: number
    testR: number; testWinRate: number
    testSharpe: number; passed: boolean
  }>
  avgR: number
  avgWinRate: number
  avgSharpe: number
  consistent: boolean
  passedMinWindows: boolean
}

type PerfStats = {
  trades: number
  winRate: number
  avgR: number
  cumR: number
  equityCurve: number[]
}

type LiveSignal = {
  symbol: string
  direction: "long" | "short"
  entry: number
  stop: number
  target: number
  rr: number
  conditions: string[]
}

type ForwardTestData = {
  historical: PerfStats
  recent: PerfStats
  liveSignals: LiveSignal[]
  vsExpected: {
    winRateDelta: number
    avgRDelta: number
    status: "on_track" | "improving" | "degrading"
  }
  scannedAt: string
}

export default function BacktestPage() {
  const [tab, setTab] = useState<"backtest" | "forward">("backtest")
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [strategyId, setStrategyId] = useState("")
  const [trades, setTrades] = useState<Trade[]>([])
  const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [simSource, setSimSource] = useState<"live" | "sim" | null>(null)
  const [simMessage, setSimMessage] = useState<string | null>(null)
  const [ftData, setFtData] = useState<ForwardTestData | null>(null)
  const [ftLoading, setFtLoading] = useState(false)

  useEffect(() => {
    fetch("/api/backtest")
      .then(r => r.json())
      .then(j => {
        setStrategies(j.strategies ?? [])
        setTrades(j.trades ?? [])
        if (j.strategies?.length) setStrategyId(j.strategies[0].id)
      })
  }, [])

  async function loadTrades(sid: string) {
    setLoading(true)
    setWfResult(null)
    try {
      const res = await fetch(`/api/backtest?strategyId=${sid}`)
      const json = await res.json()
      setTrades(json.trades ?? [])
    } finally {
      setLoading(false)
    }
  }

  // Strategy-builder overrides (12.6). Empty string = use bot.py default.
  const [showBuilder, setShowBuilder] = useState(false)
  const [pOverrides, setPOverrides] = useState<Record<string, string>>({})
  const [symbolsInput, setSymbolsInput] = useState("")

  const BUILDER_FIELDS: { key: string; label: string; hint: string }[] = [
    { key: "takeProfitPct", label: "Take profit %", hint: "0.04 = 4%" },
    { key: "maxStopRiskPct", label: "Max stop risk %", hint: "0.03 = 3%" },
    { key: "minRR", label: "Min R:R", hint: "2.0" },
    { key: "rsiMin", label: "RSI min", hint: "40" },
    { key: "rsiMax", label: "RSI max", hint: "80" },
    { key: "emaFast", label: "EMA fast", hint: "9" },
    { key: "emaSlow", label: "EMA slow", hint: "21" },
    { key: "volumeMultiplier", label: "Volume mult", hint: "1.0" },
    { key: "atrMinPct", label: "ATR min %", hint: "0.004" },
    { key: "minReversalConfluences", label: "Reversal confluences", hint: "2 of IFVG/BOS/OTE" },
    { key: "minContinuationConfluences", label: "Continuation confluences", hint: "1 of FVG/EQ/OB/BRK" },
    { key: "maxHoldBars", label: "Max hold (15m bars)", hint: "20 ≈ 5h" },
  ]

  function buildRequestBody() {
    const params: Record<string, number> = {}
    let maxHoldBars: number | undefined
    for (const [k, v] of Object.entries(pOverrides)) {
      if (v.trim() === "") continue
      const num = Number(v)
      if (Number.isNaN(num)) continue
      if (k === "maxHoldBars") maxHoldBars = num
      else params[k] = num
    }
    const symbols = symbolsInput.trim()
      ? symbolsInput.split(/[\s,]+/).map(x => x.toUpperCase()).filter(Boolean)
      : undefined
    return {
      strategyId,
      ...(Object.keys(params).length ? { params } : {}),
      ...(maxHoldBars !== undefined ? { maxHoldBars } : {}),
      ...(symbols ? { symbols } : {}),
    }
  }

  async function runWalkForward() {
    if (!strategyId) return
    setRunning(true)
    setWfResult(null)
    setSimSource(null)
    setSimMessage(null)
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody()),
      })
      const json = await res.json()
      if (json.result) setWfResult(json.result)
      if (json.trades?.length) setTrades(json.trades)
      if (json.source) setSimSource(json.source)
      if (json.message) setSimMessage(json.message)
    } finally {
      setRunning(false)
    }
  }

  async function loadForwardTest() {
    setFtLoading(true)
    try {
      const res = await fetch(`/api/forward-test?strategyId=${strategyId || "smc-ict-v4"}`)
      const json = await res.json()
      setFtData(json)
    } finally {
      setFtLoading(false)
    }
  }

  useEffect(() => {
    if (tab === "forward" && !ftData) loadForwardTest()
  }, [tab])

  // Stats from raw trades
  const wins = trades.filter(t => t.r_multiple > 0).length
  const winRate = trades.length > 0 ? wins / trades.length : 0
  const avgR = trades.length > 0 ? trades.reduce((s, t) => s + t.r_multiple, 0) / trades.length : 0
  const cumR = trades.reduce((s, t) => s + t.r_multiple, 0)

  let cum = 0
  const curve = trades.map(t => { cum += t.r_multiple; return cum })
  const minR = Math.min(0, ...curve)
  const maxR = Math.max(0.01, ...curve)
  const h = 80, w = 400
  const points = curve.map((r, i) => {
    const x = (i / Math.max(curve.length - 1, 1)) * w
    const y = h - ((r - minR) / (maxR - minR)) * h
    return `${x},${y}`
  }).join(" ")

  const statusColors = {
    on_track: "text-primary border-primary/30 bg-primary/5",
    improving: "text-green-400 border-green-400/30 bg-green-400/5",
    degrading: "text-red-400 border-red-400/30 bg-red-400/5",
  }

  return (
    <div className="p-6 space-y-6">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Testing</h1>
          <p className="text-xs text-muted-foreground mt-1">Backtest history · walk-forward · live forward test</p>
        </div>
        <div className="flex items-center gap-2">
          {strategies.length > 0 && (
            <select
              value={strategyId}
              onChange={e => { setStrategyId(e.target.value); loadTrades(e.target.value) }}
              className="text-[10px] tracking-widest bg-secondary border border-border rounded px-2 py-1 text-foreground"
            >
              {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {tab === "backtest" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowBuilder(v => !v)}
                className="text-[10px] tracking-widest h-7"
              >
                {showBuilder ? "HIDE BUILDER" : "STRATEGY BUILDER"}
              </Button>
              <Button
                size="sm"
                onClick={runWalkForward}
                disabled={running || !strategyId}
                className="text-[10px] tracking-widest h-7 bg-primary text-primary-foreground"
              >
                {running ? "RUNNING..." : "WALK-FORWARD"}
              </Button>
            </>
          )}
          {tab === "forward" && (
            <Button
              size="sm"
              onClick={loadForwardTest}
              disabled={ftLoading}
              className="text-[10px] tracking-widest h-7 bg-primary text-primary-foreground"
            >
              {ftLoading ? "SCANNING..." : "REFRESH"}
            </Button>
          )}
        </div>
      </div>

      {/* Strategy builder (12.6) — leave a field blank to keep the bot.py default */}
      {showBuilder && tab === "backtest" && (
        <div className="border border-border rounded p-4 space-y-3">
          <p className="text-[10px] text-muted-foreground tracking-widest">
            STRATEGY BUILDER — blank fields use the exact bot.py defaults · results are simulated, never traded
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {BUILDER_FIELDS.map(f => (
              <label key={f.key} className="block">
                <span className="text-[9px] text-muted-foreground tracking-widest">{f.label}</span>
                <input
                  value={pOverrides[f.key] ?? ""}
                  onChange={e => setPOverrides(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.hint}
                  className="mt-0.5 w-full text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground/60"
                />
              </label>
            ))}
          </div>
          <label className="block">
            <span className="text-[9px] text-muted-foreground tracking-widest">
              SYMBOLS (comma/space separated · blank = rotating universe top 30)
            </span>
            <input
              value={symbolsInput}
              onChange={e => setSymbolsInput(e.target.value.toUpperCase())}
              placeholder="AMD NVDA SOXL ..."
              className="mt-0.5 w-full text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground/60 uppercase"
            />
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setPOverrides({}); setSymbolsInput("") }}
              className="text-[10px] tracking-widest h-7"
            >
              RESET TO DEFAULTS
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border border-border rounded p-0.5 w-fit">
        {(["backtest", "forward"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[10px] tracking-widest px-3 py-1 rounded transition-colors ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "backtest" ? "BACKTEST" : "FORWARD TEST"}
          </button>
        ))}
      </div>

      {tab === "backtest" && (
        loading ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
          </div>
        ) : trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded gap-3">
            <p className="text-xs text-muted-foreground tracking-widest">NO LIVE TRADE DATA YET</p>
            <p className="text-[10px] text-muted-foreground text-center max-w-xs">
              Click <span className="text-primary">WALK-FORWARD</span> to run a historical simulation on 1 year of real price data across 8 symbols.
              Results appear instantly — no bot.py required.
            </p>
          </div>
        ) : (
          <>
            {simSource && (
              <div className={`text-[10px] tracking-widest px-3 py-1.5 rounded border w-fit ${
                simSource === "sim"
                  ? "border-yellow-400/30 bg-yellow-400/5 text-yellow-400"
                  : "border-primary/30 bg-primary/5 text-primary"
              }`}>
                {simSource === "sim" ? "HISTORICAL SIMULATION" : "LIVE TRADE DATA"}
                {simMessage && <span className="text-muted-foreground ml-2 normal-case">{simMessage}</span>}
              </div>
            )}

            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">PERFORMANCE</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="TRADES" value={trades.length} />
                <StatCard label="WIN RATE" value={`${(winRate * 100).toFixed(1)}%`} positive={winRate > 0.5} />
                <StatCard label="AVG R" value={`${avgR >= 0 ? "+" : ""}${avgR.toFixed(3)}`} positive={avgR >= 0} />
                <StatCard label="CUM R" value={`${cumR >= 0 ? "+" : ""}${cumR.toFixed(2)}`} positive={cumR >= 0} />
              </div>
            </div>

            {curve.length > 1 && (
              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-2">EQUITY CURVE (R)</p>
                <div className="border border-border rounded p-4 bg-secondary/10">
                  <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
                    <line x1="0" y1={h - ((0 - minR) / (maxR - minR)) * h}
                      x2={w} y2={h - ((0 - minR) / (maxR - minR)) * h}
                      stroke="#1e2d40" strokeWidth="1" strokeDasharray="4 2" vectorEffect="non-scaling-stroke" />
                    <polyline
                      points={points}
                      fill="none"
                      stroke={cumR >= 0 ? "#00d4a1" : "#ef4444"}
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </div>
              </div>
            )}

            {wfResult && (
              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-2">WALK-FORWARD RESULT</p>
                <div className={`border rounded p-4 ${
                  wfResult.passedMinWindows && wfResult.consistent
                    ? "border-primary/30 bg-primary/5"
                    : "border-red-400/30 bg-red-400/5"
                }`}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <StatCard label="AVG R" value={`${wfResult.avgR >= 0 ? "+" : ""}${wfResult.avgR.toFixed(3)}`} positive={wfResult.avgR >= 0} />
                    <StatCard label="AVG WIN RATE" value={`${(wfResult.avgWinRate * 100).toFixed(1)}%`} positive={wfResult.avgWinRate > 0.5} />
                    <StatCard label="WINDOWS" value={`${wfResult.windows.length}`} ok={wfResult.passedMinWindows} />
                    <StatCard label="CONSISTENT" value={wfResult.consistent ? "YES" : "NO"} positive={wfResult.consistent} />
                  </div>
                  <div className="space-y-1">
                    {wfResult.windows.map((w, i) => (
                      <div key={i} className="flex items-center gap-4 text-[10px] py-1 border-b border-border last:border-0">
                        <span className="text-muted-foreground w-4">{i + 1}</span>
                        <span className={w.passed ? "text-primary" : "text-red-400"}>{w.passed ? "PASS" : "FAIL"}</span>
                        <span className={`${w.testR >= 0 ? "text-primary" : "text-red-400"}`}>
                          {w.testR >= 0 ? "+" : ""}{w.testR.toFixed(3)}R
                        </span>
                        <span className="text-muted-foreground">{(w.testWinRate * 100).toFixed(0)}% WR</span>
                        <span className="text-muted-foreground ml-auto">
                          {new Date(w.testStart).toLocaleDateString()} — {new Date(w.testEnd).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">TRADES ({trades.length})</p>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-[10px] text-muted-foreground tracking-widest border-b border-border">
                      <th className="text-left pb-2">SYMBOL</th>
                      <th className="text-left pb-2">DIR</th>
                      <th className="text-right pb-2">R</th>
                      <th className="text-right pb-2">P&L</th>
                      <th className="text-left pb-2 pl-3">REGIME</th>
                      <th className="text-right pb-2">DATE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {trades.map((t, i) => (
                      <tr key={i}>
                        <td className="py-1.5 font-medium">{t.instrument}</td>
                        <td className={`py-1.5 ${t.direction === "long" ? "text-primary" : "text-red-400"}`}>
                          {t.direction.toUpperCase()}
                        </td>
                        <td className={`py-1.5 text-right ${t.r_multiple >= 0 ? "text-primary" : "text-red-400"}`}>
                          {t.r_multiple >= 0 ? "+" : ""}{t.r_multiple.toFixed(3)}
                        </td>
                        <td className={`py-1.5 text-right ${(t.pnl ?? 0) >= 0 ? "text-primary" : "text-red-400"}`}>
                          {t.pnl !== null ? `$${t.pnl.toFixed(2)}` : "—"}
                        </td>
                        <td className="py-1.5 pl-3 text-muted-foreground">{t.regime_tag ?? "—"}</td>
                        <td className="py-1.5 text-right text-muted-foreground text-[10px]">
                          {new Date(t.opened_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}

      {tab === "forward" && (
        ftLoading ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-xs text-muted-foreground tracking-widest">SCANNING LIVE BARS...</p>
          </div>
        ) : !ftData ? (
          <div className="flex items-center justify-center h-64 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
            CLICK REFRESH TO RUN FORWARD TEST
          </div>
        ) : (
          <>
            {/* Status banner */}
            <div className={`border rounded p-3 flex items-center justify-between ${statusColors[ftData.vsExpected.status]}`}>
              <div>
                <p className="text-[10px] tracking-widest font-medium">
                  STRATEGY STATUS: {ftData.vsExpected.status.replace("_", " ").toUpperCase()}
                </p>
                <p className="text-[10px] mt-0.5 opacity-80">
                  Recent 30d vs all-time: WR {ftData.vsExpected.winRateDelta >= 0 ? "+" : ""}{(ftData.vsExpected.winRateDelta * 100).toFixed(1)}% · Avg R {ftData.vsExpected.avgRDelta >= 0 ? "+" : ""}{ftData.vsExpected.avgRDelta.toFixed(3)}
                </p>
              </div>
              <p className="text-[9px] opacity-60">
                {new Date(ftData.scannedAt).toLocaleTimeString()}
              </p>
            </div>

            {/* Side-by-side comparison */}
            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">PERFORMANCE COMPARISON</p>
              <div className="grid grid-cols-2 gap-4">
                {/* Historical */}
                <div className="border border-border rounded p-3 space-y-2">
                  <p className="text-[9px] tracking-widest text-muted-foreground">ALL-TIME (HISTORICAL)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat label="TRADES" value={ftData.historical.trades} />
                    <MiniStat label="WIN RATE" value={`${(ftData.historical.winRate * 100).toFixed(1)}%`} positive={ftData.historical.winRate > 0.5} />
                    <MiniStat label="AVG R" value={`${ftData.historical.avgR >= 0 ? "+" : ""}${ftData.historical.avgR.toFixed(3)}`} positive={ftData.historical.avgR >= 0} />
                    <MiniStat label="CUM R" value={`${ftData.historical.cumR >= 0 ? "+" : ""}${ftData.historical.cumR.toFixed(2)}`} positive={ftData.historical.cumR >= 0} />
                  </div>
                  {ftData.historical.equityCurve.length > 1 && (
                    <MiniEquityCurve curve={ftData.historical.equityCurve} />
                  )}
                </div>

                {/* Recent 30d */}
                <div className="border border-border rounded p-3 space-y-2">
                  <p className="text-[9px] tracking-widest text-muted-foreground">LAST 30 DAYS (FORWARD)</p>
                  {ftData.recent.trades === 0 ? (
                    <p className="text-[10px] text-muted-foreground py-4 text-center">No completed trades in last 30 days</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="TRADES" value={ftData.recent.trades} />
                      <MiniStat label="WIN RATE" value={`${(ftData.recent.winRate * 100).toFixed(1)}%`} positive={ftData.recent.winRate > 0.5} />
                      <MiniStat label="AVG R" value={`${ftData.recent.avgR >= 0 ? "+" : ""}${ftData.recent.avgR.toFixed(3)}`} positive={ftData.recent.avgR >= 0} />
                      <MiniStat label="CUM R" value={`${ftData.recent.cumR >= 0 ? "+" : ""}${ftData.recent.cumR.toFixed(2)}`} positive={ftData.recent.cumR >= 0} />
                    </div>
                  )}
                  {ftData.recent.equityCurve.length > 1 && (
                    <MiniEquityCurve curve={ftData.recent.equityCurve} />
                  )}
                </div>
              </div>
            </div>

            {/* Live signals */}
            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
                LIVE CONDITIONS SCAN — CURRENT SIGNALS ({ftData.liveSignals.length})
              </p>
              {ftData.liveSignals.length === 0 ? (
                <div className="border border-dashed rounded p-4 text-center text-xs text-muted-foreground tracking-widest">
                  NO ACTIVE SIGNALS — conditions not met in any scanned symbol right now
                </div>
              ) : (
                <div className="space-y-2">
                  {ftData.liveSignals.map((sig, i) => (
                    <div key={i} className={`border rounded p-3 flex items-start justify-between ${
                      sig.direction === "long" ? "border-primary/30 bg-primary/5" : "border-red-400/30 bg-red-400/5"
                    }`}>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">{sig.symbol}</span>
                          <span className={`text-[10px] tracking-widest ${sig.direction === "long" ? "text-primary" : "text-red-400"}`}>
                            {sig.direction.toUpperCase()}
                          </span>
                          <span className="text-[10px] text-muted-foreground">R:R {sig.rr.toFixed(1)}x</span>
                        </div>
                        <div className="flex gap-3 text-[10px]">
                          <span>Entry <span className="text-foreground">${sig.entry.toFixed(2)}</span></span>
                          <span>Stop <span className="text-red-400">${sig.stop.toFixed(2)}</span></span>
                          <span>Target <span className="text-primary">${sig.target.toFixed(2)}</span></span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {sig.conditions.map((c, ci) => (
                            <span key={ci} className="text-[9px] bg-secondary border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      )}
    </div>
  )
}

function MiniEquityCurve({ curve }: { curve: number[] }) {
  const minR = Math.min(0, ...curve)
  const maxR = Math.max(0.01, ...curve)
  const cumR = curve[curve.length - 1] ?? 0
  const h = 40, w = 200
  const pts = curve.map((r, i) => {
    const x = (i / Math.max(curve.length - 1, 1)) * w
    const y = h - ((r - minR) / (maxR - minR)) * h
    return `${x},${y}`
  }).join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={cumR >= 0 ? "#00d4a1" : "#ef4444"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function MiniStat({ label, value, positive }: { label: string; value: string | number; positive?: boolean }) {
  return (
    <div>
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className={`text-xs font-medium mt-0.5 ${
        positive === undefined ? "text-foreground" : positive ? "text-primary" : "text-red-400"
      }`}>
        {String(value)}
      </p>
    </div>
  )
}

function StatCard({ label, value, positive, ok }: { label: string; value: string | number; positive?: boolean; ok?: boolean }) {
  return (
    <div className="bg-secondary border border-border rounded p-2">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${
        ok === false ? "text-red-400" : ok === true ? "text-primary" :
        positive === undefined ? "text-foreground" : positive ? "text-primary" : "text-red-400"
      }`}>
        {String(value)}
      </p>
    </div>
  )
}
