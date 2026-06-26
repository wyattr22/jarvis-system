"use client"

import { useEffect, useState, useRef, useCallback } from "react"

const DEFAULT_SYMBOLS = ["TSLA", "RIOT", "MARA", "HUT", "IONQ", "HOOD", "SNAP", "NVDA", "SPY", "QQQ", "AAPL", "ALAB"]

const TIMEFRAMES = [
  { label: "1m",  tv: "1"  },
  { label: "5m",  tv: "5"  },
  { label: "15m", tv: "15" },
  { label: "30m", tv: "30" },
  { label: "1h",  tv: "60" },
  { label: "1D",  tv: "D"  },
]

const LEGACY_TF: Record<string, string> = {
  "1Min": "1m", "5Min": "5m", "15Min": "15m",
  "30Min": "30m", "1Hour": "1h", "1Day": "1D",
}

type ZoneLevel = { price: number; label: string; color: string }
type PriceRange = { min: number; max: number }

// Only setSymbol is available on the free tv.js widget — createShape belongs to the paid Charting Library
interface TVChartAPI {
  setSymbol(symbol: string, interval: string, cb: () => void): void
}

interface TVWidget {
  onChartReady(cb: () => void): void
  chart(): TVChartAPI
  remove(): void
}

declare global {
  interface Window {
    TradingView: { widget: new (cfg: Record<string, unknown>) => TVWidget }
  }
}

export default function ChartsPage() {
  const [symbol, setSymbol]       = useState("TSLA")
  const [tfIdx, setTfIdx]         = useState(2)
  const [search, setSearch]       = useState("")
  const [quickSymbols, setQuickSymbols] = useState<string[]>(DEFAULT_SYMBOLS)

  // Zone overlay state — cleared on every symbol/tf change
  const [drawnLevels, setDrawnLevels]       = useState<ZoneLevel[]>([])
  const [levelPriceRange, setLevelPriceRange] = useState<PriceRange | null>(null)

  // Structure watch state
  const [watching, setWatching]         = useState(false)
  const [showConditions, setShowConditions] = useState(false)
  const [conditions, setConditions] = useState({
    bos:   true,
    fvg:   true,
    ote:   true,
    ob:    true,
    sweep: true,
  })

  type WatchAlert = {
    id: number
    type: 'bos_bull' | 'bos_bear' | 'fvg' | 'ote' | 'ob_bull' | 'ob_bear' | 'sweep_bull' | 'sweep_bear'
    label: string
    detail: string
    symbol: string
    firedAt: number  // Date.now()
  }
  const [watchAlerts, setWatchAlerts] = useState<WatchAlert[]>([])
  const [dismissedIds, setDismissedIds] = useState<number[]>([])
  const [showLog, setShowLog] = useState(false)
  const alertIdRef = useRef(0)

  type WatchBaseline = {
    symbol: string
    swingHigh: number
    swingLow: number
    inFVGKeys: string[]
    inOTE: boolean
    inOBKeys: string[]
    sweptHighs: number[]
    sweptLows: number[]
  }
  const watchBaseRef = useRef<WatchBaseline | null>(null)

  function pushAlert(a: Omit<WatchAlert, 'id' | 'firedAt'>) {
    const id = ++alertIdRef.current
    setWatchAlerts(prev => [{ ...a, id, firedAt: Date.now() }, ...prev].slice(0, 50))
  }

  const symbolRef    = useRef("TSLA")
  const tfIdxRef     = useRef(2)
  const widgetRef    = useRef<TVWidget | null>(null)
  const chartRef     = useRef<TVChartAPI | null>(null)
  const readyRef     = useRef(false)
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { symbolRef.current = symbol }, [symbol])
  useEffect(() => { tfIdxRef.current  = tfIdx   }, [tfIdx])

  // Reset watch state when symbol changes
  useEffect(() => {
    watchBaseRef.current = null
    setWatchAlerts([])
  }, [symbol])

  // Map chart timeframe label → Alpaca API timeframe string + poll interval (ms)
  const TF_TO_ALPACA: Record<string, { alpaca: string; pollMs: number }> = {
    "1m":  { alpaca: "1Min",  pollMs: 15_000  },
    "5m":  { alpaca: "5Min",  pollMs: 30_000  },
    "15m": { alpaca: "15Min", pollMs: 60_000  },
    "30m": { alpaca: "30Min", pollMs: 90_000  },
    "1h":  { alpaca: "1Hour", pollMs: 120_000 },
    "1D":  { alpaca: "1Day",  pollMs: 300_000 },
  }

  // Polling loop — interval adapts to selected timeframe, checks all enabled conditions
  useEffect(() => {
    if (!watching) return
    let cancelled = false
    let timerId: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      const sym = symbolRef.current
      const tf  = TIMEFRAMES[tfIdxRef.current].label
      const { alpaca, pollMs } = TF_TO_ALPACA[tf] ?? { alpaca: "15Min", pollMs: 60_000 }

      try {
        const res = await fetch(`/api/bars/${sym}?timeframe=${alpaca}&limit=150`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const smc = data.smc
        if (!smc?.swingHighs?.length || !smc?.swingLows?.length) return

        const price: number     = smc.currentPrice
        const swingHigh: number = smc.swingHighs[0].price
        const swingLow: number  = smc.swingLows[0].price

        // FVG keys for dedup
        const fvgs: { high: number; low: number; type: string }[] = [
          ...(smc.fvgsAbove ?? []), ...(smc.fvgsBelow ?? [])
        ]
        const inFVGKeys = fvgs
          .filter((f: { high: number; low: number }) => price >= f.low && price <= f.high)
          .map((f: { high: number; low: number }) => `${f.high.toFixed(2)}_${f.low.toFixed(2)}`)

        const inOTE = !!(smc.oteZone && price >= smc.oteZone.low && price <= smc.oteZone.high)

        type OBEntry = { high: number; low: number; side: string }
        const obs: OBEntry[] = [
          ...(smc.bullishOBs ?? []).map((o: { high: number; low: number }) => ({ ...o, side: 'bull' })),
          ...(smc.bearishOBs ?? []).map((o: { high: number; low: number }) => ({ ...o, side: 'bear' })),
        ]
        const inOBKeys = obs
          .filter((o: OBEntry) => price >= o.low && price <= o.high)
          .map((o: OBEntry) => `${o.side}_${o.high.toFixed(2)}_${o.low.toFixed(2)}`)

        const equalHighs: number[] = smc.equalHighs ?? []
        const equalLows:  number[] = smc.equalLows  ?? []
        const sweptHighs = equalHighs.filter((h: number) => price > h)
        const sweptLows  = equalLows.filter((l: number) => price < l)

        const prev = watchBaseRef.current
        if (!prev || prev.symbol !== sym) {
          // Seed baseline — no alerts on first poll
          watchBaseRef.current = { symbol: sym, swingHigh, swingLow, inFVGKeys, inOTE, inOBKeys, sweptHighs, sweptLows }
          if (!cancelled) timerId = setTimeout(poll, pollMs)
          return
        }

        // ── BOS ──────────────────────────────────────────
        if (conditions.bos) {
          if (price > prev.swingHigh)
            pushAlert({ type: 'bos_bull', label: 'BULLISH BOS', detail: `Price $${price.toFixed(2)} broke above swing high $${prev.swingHigh.toFixed(2)}`, symbol: sym })
          else if (price < prev.swingLow)
            pushAlert({ type: 'bos_bear', label: 'BEARISH BOS', detail: `Price $${price.toFixed(2)} broke below swing low $${prev.swingLow.toFixed(2)}`, symbol: sym })
        }

        // ── FVG Entry ─────────────────────────────────────
        if (conditions.fvg) {
          for (const key of inFVGKeys) {
            if (!prev.inFVGKeys.includes(key)) {
              const fvg = fvgs.find((f: { high: number; low: number }) => `${f.high.toFixed(2)}_${f.low.toFixed(2)}` === key)
              if (fvg) pushAlert({ type: 'fvg', label: 'FVG ENTRY', detail: `Price $${price.toFixed(2)} entered ${fvg.type} FVG $${fvg.low.toFixed(2)}–$${fvg.high.toFixed(2)}`, symbol: sym })
            }
          }
        }

        // ── OTE Zone Entry ────────────────────────────────
        if (conditions.ote && inOTE && !prev.inOTE) {
          pushAlert({ type: 'ote', label: 'OTE ZONE', detail: `Price $${price.toFixed(2)} entered OTE zone $${smc.oteZone.low.toFixed(2)}–$${smc.oteZone.high.toFixed(2)} (${smc.oteZone.direction})`, symbol: sym })
        }

        // ── Order Block Test ──────────────────────────────
        if (conditions.ob) {
          for (const key of inOBKeys) {
            if (!prev.inOBKeys.includes(key)) {
              const isBull = key.startsWith('bull')
              pushAlert({ type: isBull ? 'ob_bull' : 'ob_bear', label: isBull ? 'BULL OB TEST' : 'BEAR OB TEST', detail: `Price $${price.toFixed(2)} touching ${isBull ? 'bullish' : 'bearish'} order block`, symbol: sym })
            }
          }
        }

        // ── Liquidity Sweep ───────────────────────────────
        if (conditions.sweep) {
          for (const h of sweptHighs) {
            if (!prev.sweptHighs.includes(h))
              pushAlert({ type: 'sweep_bull', label: 'BSL SWEPT', detail: `Buy-side liquidity swept at $${h.toFixed(2)}`, symbol: sym })
          }
          for (const l of sweptLows) {
            if (!prev.sweptLows.includes(l))
              pushAlert({ type: 'sweep_bear', label: 'SSL SWEPT', detail: `Sell-side liquidity swept at $${l.toFixed(2)}`, symbol: sym })
          }
        }

        watchBaseRef.current = { symbol: sym, swingHigh, swingLow, inFVGKeys, inOTE, inOBKeys, sweptHighs, sweptLows }
      } catch { /* ignore */ }

      if (!cancelled) timerId = setTimeout(poll, pollMs)
    }

    poll()
    return () => { cancelled = true; if (timerId) clearTimeout(timerId) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, conditions])

  // Clear the SVG zone overlay whenever the chart changes
  const clearDrawings = useCallback(() => {
    setDrawnLevels([])
    setLevelPriceRange(null)
  }, [])

  // ── initWidget ─────────────────────────────────────────────────
  const initWidget = useCallback((sym: string, interval: string) => {
    clearDrawings()

    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current)
      initTimerRef.current = null
    }
    if (widgetRef.current) {
      try { widgetRef.current.remove() } catch { /* ignore */ }
      widgetRef.current = null
      chartRef.current  = null
      readyRef.current  = false
    }

    initTimerRef.current = setTimeout(() => {
      initTimerRef.current = null
      if (!containerRef.current) return

      const uid = `tv_${Date.now()}`
      containerRef.current.innerHTML = ""
      const el = document.createElement("div")
      el.id = uid
      el.style.cssText = "width:100%;height:100%"
      containerRef.current.appendChild(el)

      function create() {
        if (!window.TradingView) return
        const w = new window.TradingView.widget({
          autosize: true,
          symbol:   sym,
          interval,
          timezone: "America/New_York",
          theme:    "dark",
          style:    "1",
          locale:   "en",
          toolbar_bg:          "#080d14",
          enable_publishing:   false,
          allow_symbol_change: true,
          container_id:        uid,
          studies: ["RSI@tv-basicstudies", "VWAP@tv-basicstudies"],
          overrides: {
            "paneProperties.background":     "#080d14",
            "paneProperties.backgroundType": "solid",
          },
          loading_screen: { backgroundColor: "#080d14", foregroundColor: "#00d4a1" },
        })
        widgetRef.current = w
        w.onChartReady(() => {
          readyRef.current = true
          chartRef.current = w.chart()
        })
      }

      if (window.TradingView) {
        create()
      } else if (!document.getElementById("tv-script")) {
        const s = document.createElement("script")
        s.id    = "tv-script"
        s.src   = "https://s3.tradingview.com/tv.js"
        s.async = true
        s.onload = create
        document.head.appendChild(s)
      } else {
        const poll = setInterval(() => {
          if (window.TradingView) { clearInterval(poll); create() }
        }, 80)
      }
    }, 200)
  }, [clearDrawings])

  // ── applyChange ────────────────────────────────────────────────
  const applyChange = useCallback((sym: string, interval: string) => {
    clearDrawings()
    if (readyRef.current && chartRef.current) {
      try {
        chartRef.current.setSymbol(sym, interval, () => {})
        return
      } catch {
        // setSymbol not available on free tier — fall through to full reinit
      }
    }
    initWidget(sym, interval)
  }, [initWidget, clearDrawings])

  // ── Load watchlist symbols for quick strip ─────────────────────
  useEffect(() => {
    fetch("/api/watchlist")
      .then(r => r.json())
      .then(data => {
        const items: { instrument: string }[] = data.watchlist ?? []
        if (items.length > 0) {
          setQuickSymbols(items.map(i => i.instrument))
        }
      })
      .catch(() => {})
  }, [])

  // ── Mount once ─────────────────────────────────────────────────
  useEffect(() => {
    const savedSym   = localStorage.getItem("jarvis_chart_symbol") ?? "TSLA"
    const rawTf      = localStorage.getItem("jarvis_chart_timeframe") ?? ""
    const resolvedTf = LEGACY_TF[rawTf] ?? rawTf
    const i          = TIMEFRAMES.findIndex(t => t.label === resolvedTf || t.tv === resolvedTf)
    const savedTfIdx = i >= 0 ? i : 2

    setSymbol(savedSym);  symbolRef.current = savedSym
    setTfIdx(savedTfIdx); tfIdxRef.current  = savedTfIdx

    initWidget(savedSym, TIMEFRAMES[savedTfIdx].tv)

    const loadHandler = (e: Event) => {
      const { symbol: s, timeframe: t } = (e as CustomEvent).detail as { symbol?: string; timeframe?: string }
      const newSym   = s?.toUpperCase() ?? symbolRef.current
      const resolved = t ? (LEGACY_TF[t] ?? t) : ""
      const newTfI   = resolved ? TIMEFRAMES.findIndex(f => f.label === resolved || f.tv === resolved) : -1
      const newTfIdx = newTfI >= 0 ? newTfI : tfIdxRef.current
      const interval = TIMEFRAMES[newTfIdx].tv

      setSymbol(newSym);  symbolRef.current = newSym
      if (newTfI >= 0) { setTfIdx(newTfI); tfIdxRef.current = newTfI }
      localStorage.setItem("jarvis_chart_symbol", newSym)
      applyChange(newSym, interval)
    }

    // jarvis:drawZone — render an SVG zone overlay on the chart
    const drawHandler = (e: Event) => {
      const { levels, priceRange } = (e as CustomEvent).detail as {
        levels?: ZoneLevel[]
        priceRange?: PriceRange
      }
      if (!levels?.length || !priceRange) return
      setDrawnLevels(levels)
      setLevelPriceRange(priceRange)
    }

    window.addEventListener("jarvis:loadChart", loadHandler)
    window.addEventListener("jarvis:drawZone",  drawHandler)

    return () => {
      window.removeEventListener("jarvis:loadChart", loadHandler)
      window.removeEventListener("jarvis:drawZone",  drawHandler)
      if (initTimerRef.current) clearTimeout(initTimerRef.current)
      if (widgetRef.current) {
        try { widgetRef.current.remove() } catch { /* ignore */ }
        widgetRef.current = null
      }
    }
  }, [initWidget, applyChange])

  function changeSymbol(sym: string) {
    setSymbol(sym)
    symbolRef.current = sym
    localStorage.setItem("jarvis_chart_symbol", sym)
    applyChange(sym, TIMEFRAMES[tfIdxRef.current].tv)
  }

  function changeTf(idx: number) {
    setTfIdx(idx)
    tfIdxRef.current = idx
    applyChange(symbolRef.current, TIMEFRAMES[idx].tv)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const s = search.trim().toUpperCase()
    if (s) { changeSymbol(s); setSearch("") }
  }

  // ── Zone overlay helpers ───────────────────────────────────────
  // TradingView free widget layout: toolbar ~52px top, RSI pane ~100px bottom
  // SVG covers the price chart area between those, using priceRange for Y-mapping
  function zoneY(price: number, range: PriceRange): number {
    const span = range.max - range.min
    if (span <= 0) return 50
    return (1 - (price - range.min) / span) * 100
  }

  return (
    <div className="flex flex-col gap-2 p-3" style={{ height: "calc(100vh - 1px)" }}>

      {/* Controls row */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 relative">
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">{symbol}</h1>

          {/* Watch toggle */}
          <button
            onClick={() => { setWatching(w => !w); setWatchAlerts([]); watchBaseRef.current = null; setShowConditions(false) }}
            className={[
              "text-[9px] tracking-widest px-2 py-1 rounded border transition-all",
              watching
                ? "border-yellow-400/60 text-yellow-400 bg-yellow-400/10 animate-pulse"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
            ].join(" ")}
          >
            {watching ? "◉ WATCHING" : "WATCH"}
          </button>

          {/* Conditions gear */}
          <button
            onClick={() => { setShowConditions(v => !v); setShowLog(false) }}
            title="Configure watch conditions"
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
          >
            ⚙
          </button>

          {/* Signal log button */}
          <button
            onClick={() => { setShowLog(v => !v); setShowConditions(false) }}
            title="Signal log"
            className={[
              "text-[9px] tracking-widest px-1.5 py-0.5 rounded border transition-all relative",
              showLog ? "border-primary/50 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            LOG
            {watchAlerts.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary text-[7px] text-primary-foreground flex items-center justify-center font-bold">
                {watchAlerts.length > 9 ? '9+' : watchAlerts.length}
              </span>
            )}
          </button>

          {/* Conditions panel */}
          {showConditions && (
            <div className="absolute top-7 left-0 z-30 bg-background border border-border rounded-lg shadow-2xl p-3 w-48 space-y-2">
              <p className="text-[9px] tracking-widest text-muted-foreground mb-2">WATCH CONDITIONS</p>
              {([ ['bos', 'Break of Structure'], ['fvg', 'FVG Entry'], ['ote', 'OTE Zone'], ['ob', 'Order Block'], ['sweep', 'Liquidity Sweep'] ] as [keyof typeof conditions, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={conditions[key]}
                    onChange={e => setConditions(c => ({ ...c, [key]: e.target.checked }))}
                    className="accent-primary w-3 h-3"
                  />
                  <span className="text-[10px] text-foreground group-hover:text-primary transition-colors">{label}</span>
                </label>
              ))}
            </div>
          )}

          {/* Signal log panel */}
          {showLog && (
            <div className="absolute top-7 left-0 z-30 bg-background border border-border rounded-lg shadow-2xl w-80 flex flex-col" style={{ maxHeight: 340 }}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
                <p className="text-[9px] tracking-widest text-muted-foreground">SIGNAL LOG</p>
                {watchAlerts.length > 0 && (
                  <button onClick={() => { setWatchAlerts([]); setDismissedIds([]) }} className="text-[9px] text-red-400/60 hover:text-red-400 transition-colors">CLEAR</button>
                )}
              </div>
              <div className="overflow-y-auto flex-1">
                {watchAlerts.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-6 tracking-wider">No signals fired yet</p>
                ) : (
                  watchAlerts.map(a => {
                    const isBull = ['bos_bull','fvg','ote','ob_bull','sweep_bull'].includes(a.type)
                    const time = new Date(a.firedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                    return (
                      <div key={a.id} className="flex items-start gap-2 px-3 py-2 border-b border-border/50 hover:bg-secondary/30 transition-colors">
                        <span className={`text-[10px] flex-shrink-0 mt-0.5 ${isBull ? 'text-emerald-400' : 'text-red-400'}`}>
                          {['bos_bull','bos_bear'].includes(a.type) ? '◈' : a.type === 'fvg' ? '⬛' : a.type === 'ote' ? '◆' : a.type.includes('ob') ? '▣' : '↯'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className={`text-[9px] font-bold tracking-widest ${isBull ? 'text-emerald-400' : 'text-red-400'}`}>{a.label}</span>
                            <span className="text-[9px] text-muted-foreground font-mono flex-shrink-0">{time}</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 truncate">{a.detail}</p>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={handleSearch} className="flex">
            <input
              value={search}
              onChange={e => setSearch(e.target.value.toUpperCase())}
              placeholder="SEARCH TICKER..."
              className="text-[10px] tracking-widest bg-secondary border border-border rounded-l px-2 py-1 text-foreground placeholder:text-muted-foreground w-28 uppercase"
            />
            <button type="submit" className="text-[10px] tracking-widest bg-primary text-primary-foreground px-2 py-1 rounded-r">
              GO
            </button>
          </form>
          <div className="flex rounded border border-border overflow-hidden">
            {TIMEFRAMES.map((t, i) => (
              <button
                key={t.label}
                onClick={() => changeTf(i)}
                className={`px-2 py-1 text-[10px] tracking-widest transition-colors ${
                  i === tfIdx
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Symbol strip — driven by watchlist */}
      <div className="flex gap-1 overflow-x-auto flex-shrink-0 pb-0.5">
        {quickSymbols.map(s => (
          <button
            key={s}
            onClick={() => changeSymbol(s)}
            className={`flex-shrink-0 px-2 py-1 rounded text-[10px] tracking-widest transition-colors border ${
              s === symbol
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-secondary border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Chart container — relative so the SVG overlay can be absolutely positioned */}
      <div ref={containerRef} className="flex-1 rounded border border-border overflow-hidden min-h-0 relative">
        {/* initWidget injects a fresh div here every time */}

        {/* Watch alert stack — shows only non-dismissed alerts */}
        {watchAlerts.filter(a => !dismissedIds.includes(a.id)).length > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col gap-1.5 w-80">
            {watchAlerts.filter(a => !dismissedIds.includes(a.id)).map(a => {
              const isBull = ['bos_bull','fvg','ote','ob_bull','sweep_bull'].includes(a.type)
              const colors = isBull
                ? "bg-emerald-950/95 border-emerald-400/60 text-emerald-300"
                : "bg-red-950/95 border-red-400/60 text-red-300"
              const icon = a.type === 'fvg' ? '⬛' : a.type === 'ote' ? '◈' : a.type.includes('ob') ? '▣' : a.type.includes('sweep') ? '↯' : isBull ? '▲' : '▼'
              return (
                <div key={a.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border shadow-xl text-xs font-mono ${colors}`}>
                  <span className="text-sm mt-0.5 flex-shrink-0">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold tracking-widest text-[10px]">{a.symbol} — {a.label}</p>
                    <p className="text-[9px] opacity-80 leading-tight mt-0.5">{a.detail}</p>
                  </div>
                  {/* ✕ only dismisses from overlay — alert stays in log */}
                  <button onClick={() => setDismissedIds(p => [...p, a.id])} className="opacity-50 hover:opacity-100 transition-opacity flex-shrink-0 leading-none">✕</button>
                </div>
              )
            })}
            {watchAlerts.filter(a => !dismissedIds.includes(a.id)).length > 1 && (
              <button
                onClick={() => setDismissedIds(p => [...p, ...watchAlerts.map(a => a.id)])}
                className="text-[9px] text-muted-foreground hover:text-foreground text-center transition-colors"
              >
                DISMISS ALL
              </button>
            )}
          </div>
        )}

        {/* Jarvis zone overlay — SVG drawn on top of TradingView iframe */}
        {drawnLevels.length > 0 && levelPriceRange && (
          <svg
            className="absolute pointer-events-none"
            style={{
              // Offset below TradingView toolbar (~52px) and above RSI pane (~100px)
              top: 52,
              left: 0,
              right: 0,
              bottom: 100,
              width: "100%",
              height: "calc(100% - 152px)",
              zIndex: 10,
              overflow: "visible",
            }}
          >
            {drawnLevels.map((lvl, i) => {
              const yPct = zoneY(lvl.price, levelPriceRange)
              if (yPct < -2 || yPct > 102) return null
              const y = `${Math.max(0, Math.min(100, yPct))}%`
              const label = lvl.label
                ? `${lvl.label}  ${lvl.price.toFixed(2)}`
                : lvl.price.toFixed(2)
              return (
                <g key={`zone-${i}`}>
                  {/* Dashed price line */}
                  <line
                    x1="0" y1={y}
                    x2="100%" y2={y}
                    stroke={lvl.color}
                    strokeWidth="1.5"
                    strokeDasharray="8 5"
                    opacity="0.9"
                  />
                  {/* Label with dark knockout outline for readability on chart */}
                  <text
                    x="10" y={y}
                    dy="-4"
                    fill={lvl.color}
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="700"
                    stroke="#080d14"
                    strokeWidth="3"
                    paintOrder="stroke"
                    opacity="0.95"
                  >
                    {label}
                  </text>
                  {/* Right-side price label */}
                  <text
                    x="calc(100% - 6px)"
                    y={y}
                    dy="-4"
                    textAnchor="end"
                    fill={lvl.color}
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="600"
                    stroke="#080d14"
                    strokeWidth="3"
                    paintOrder="stroke"
                    opacity="0.8"
                  >
                    {lvl.price.toFixed(2)}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>

    </div>
  )
}
