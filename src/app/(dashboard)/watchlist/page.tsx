"use client"

import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { FreshnessBadge } from "@/components/ui/freshness-badge"
import type { QuoteMeta } from "@/lib/data/freshness"

type WatchItem = {
  instrument: string
  added_by: string
  reason: string | null
  pattern_json: string | null
  lift: number | null
  p_value: number | null
  created_at: number
}

type Quote = { bid: number; ask: number; mid: number; meta?: QuoteMeta }

type SearchResult = { symbol: string; name: string; assetClass: string }

const AGENT_COLOR: Record<string, string> = {
  observer:   "text-primary border-primary/30",
  researcher: "text-blue-400 border-blue-400/30",
  user:       "text-muted-foreground border-border",
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(true)
  const [addSymbol, setAddSymbol] = useState("")
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced cross-asset typeahead against /api/symbols/search
  function onSearchInput(value: string) {
    setAddSymbol(value.toUpperCase())
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (value.trim().length < 1) { setSuggestions([]); return }
    searchTimer.current = setTimeout(() => {
      fetch(`/api/symbols/search?q=${encodeURIComponent(value.trim())}`)
        .then(r => r.json())
        .then(d => setSuggestions((d.results ?? []).slice(0, 8)))
        .catch(() => setSuggestions([]))
    }, 200)
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/watchlist")
      const json = await res.json()
      setItems(json.watchlist ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // SSE for live quotes on watched instruments
  useEffect(() => {
    const es = new EventSource("/api/stream")
    es.onmessage = e => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === "quotes") {
          const map: Record<string, Quote> = {}
          for (const q of msg.data) if (!q.error) map[q.symbol] = q
          setQuotes(prev => ({ ...prev, ...map }))
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [])

  // Also fetch quotes for instruments not in the SSE stream
  useEffect(() => {
    const instruments = items.map(i => i.instrument)
    if (!instruments.length) return
    const missing = instruments.filter(s => !quotes[s])
    if (!missing.length) return

    Promise.all(missing.map(s =>
      fetch(`/api/quote/${s}`).then(r => r.json()).catch(() => null)
    )).then(results => {
      const map: Record<string, Quote> = {}
      for (const q of results) {
        if (q && q.symbol) map[q.symbol] = q
      }
      setQuotes(prev => ({ ...prev, ...map }))
    })
  }, [items])

  async function addManual() {
    const s = addSymbol.trim().toUpperCase()
    if (!s) return
    setAdding(true)
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument: s, addedBy: "user", reason: "Manual add" }),
      })
      setAddSymbol("")
      await load()
    } finally {
      setAdding(false)
    }
  }

  async function remove(instrument: string) {
    await fetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrument }),
    })
    await load()
  }

  // Group by who added them
  const byAgent = items.reduce<Record<string, WatchItem[]>>((acc, item) => {
    acc[item.added_by] = [...(acc[item.added_by] ?? []), item]
    return acc
  }, {})

  const empty = items.length === 0 && !loading

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Watchlist</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Agent-curated · Observer adds instruments with strong patterns · {items.length} watched
          </p>
        </div>

        {/* Manual add with cross-asset typeahead */}
        <div className="flex items-center gap-2 relative">
          <div className="relative">
            <input
              value={addSymbol}
              onChange={e => onSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { setSuggestions([]); addManual() } }}
              onBlur={() => setTimeout(() => setSuggestions([]), 150)}
              placeholder="ADD SYMBOL..."
              className="text-[10px] tracking-widest bg-secondary border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground w-40 uppercase"
            />
            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 z-20 bg-background border border-border rounded shadow-lg overflow-hidden">
                {suggestions.map(s => (
                  <button
                    key={`${s.assetClass}:${s.symbol}`}
                    onMouseDown={() => { setAddSymbol(s.symbol); setSuggestions([]) }}
                    className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-secondary/60"
                  >
                    <span className="text-xs text-foreground font-medium">{s.symbol}</span>
                    <span className="text-[10px] text-muted-foreground truncate ml-2 flex-1 text-right">{s.name}</span>
                    <span className="text-[9px] text-primary ml-2 uppercase">{s.assetClass}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            size="sm"
            onClick={addManual}
            disabled={adding || !addSymbol.trim()}
            className="text-[10px] tracking-widest h-7 bg-primary text-primary-foreground"
          >
            {adding ? "..." : "ADD"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : empty ? (
        <div className="space-y-4">
          <div className="flex items-center justify-center h-40 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
            NO INSTRUMENTS WATCHED YET
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Observer populates this automatically when it finds patterns with lift &gt; 1.3 and p &lt; 0.05.
            Run the council cycle or add instruments manually above.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(byAgent).map(([agent, agentItems]) => (
            <div key={agent}>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
                ADDED BY {agent.toUpperCase()} ({agentItems.length})
              </p>
              <div className="space-y-2">
                {agentItems.map(item => {
                  const q = quotes[item.instrument]
                  const pattern = item.pattern_json
                    ? (() => { try { return JSON.parse(item.pattern_json) } catch { return null } })()
                    : null
                  const isExpanded = expanded === item.instrument

                  return (
                    <div key={item.instrument} className="border border-border rounded overflow-hidden">
                      <div className="flex items-center gap-3 p-3">
                        {/* Symbol + price */}
                        <Link
                          href="/charts"
                          onClick={() => {
                            localStorage.setItem("jarvis_chart_symbol", item.instrument)
                            window.dispatchEvent(new CustomEvent("jarvis:loadChart", { detail: { symbol: item.instrument } }))
                          }}
                          className="flex-shrink-0"
                        >
                          <p className="text-sm font-medium text-foreground hover:text-primary transition-colors">
                            {item.instrument}
                          </p>
                        </Link>

                        <div className="flex-shrink-0 flex items-center gap-2">
                          {q ? (
                            <>
                              <p className="text-sm font-medium tabular-nums text-foreground">
                                ${q.mid.toFixed(2)}
                              </p>
                              {q.meta && <FreshnessBadge meta={q.meta} />}
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">—</p>
                          )}
                        </div>

                        {/* Agent badge */}
                        <Badge variant="outline" className={`text-[9px] ${AGENT_COLOR[agent] ?? "text-muted-foreground border-border"}`}>
                          {agent.toUpperCase()}
                        </Badge>

                        {/* Lift badge */}
                        {item.lift !== null && (
                          <span className="text-[9px] text-primary border border-primary/20 rounded px-1">
                            {(item.lift * 100 - 100).toFixed(0)}% LIFT
                          </span>
                        )}

                        {/* P-value */}
                        {item.p_value !== null && (
                          <span className="text-[9px] text-muted-foreground">
                            p={item.p_value.toFixed(3)}
                          </span>
                        )}

                        {/* Reason (truncated) */}
                        {item.reason && (
                          <p className="text-[10px] text-muted-foreground flex-1 truncate">{item.reason}</p>
                        )}

                        <div className="ml-auto flex items-center gap-2">
                          {pattern && (
                            <button
                              onClick={() => setExpanded(isExpanded ? null : item.instrument)}
                              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {isExpanded ? "▲" : "▼"}
                            </button>
                          )}
                          <button
                            onClick={() => remove(item.instrument)}
                            className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      {/* Expanded pattern detail */}
                      {isExpanded && pattern && (
                        <div className="border-t border-border bg-secondary/20 px-3 py-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <Detail label="FEATURE" value={pattern.featureName} />
                          <Detail label="DIRECTION" value={`${pattern.direction} ${pattern.threshold?.toFixed(3)}`} />
                          <Detail label="BASE WIN RATE" value={`${(pattern.baseWinRate * 100).toFixed(1)}%`} />
                          <Detail label="FILTERED WIN RATE" value={`${(pattern.filteredWinRate * 100).toFixed(1)}%`} />
                          <Detail label="SAMPLE SIZE" value={pattern.sampleSize} />
                          <Detail label="LIFT" value={`${(pattern.lift * 100 - 100).toFixed(0)}%`} />
                          <Detail label="P-VALUE" value={pattern.pValue?.toFixed(4)} />
                          <Detail
                            label="ADDED"
                            value={new Date(item.created_at).toLocaleDateString()}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div>
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className="text-xs font-medium text-foreground mt-0.5">{String(value ?? "—")}</p>
    </div>
  )
}
