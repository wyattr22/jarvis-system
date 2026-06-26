"use client"

import { useEffect, useState, useCallback, useRef } from "react"

type Article = {
  id: string
  headline: string
  summary: string
  url: string
  source: string
  publishedAt: string
  symbols: string[]
}

type EarningsItem = {
  symbol: string
  name: string
  reportDate: string
  fiscalDateEnding: string
  estimate: string
  currency: string
}

const SECTORS: Record<string, string[]> = {
  "TECH":     ["AAPL","MSFT","NVDA","GOOGL","GOOG","META","AMZN","TSLA","IONQ","SNAP","CRDO","ALAB","AAOI","AMD","INTC","QCOM"],
  "FINANCE":  ["HOOD","JPM","BAC","GS","MS","WFC","C","V","MA","PYPL","SQ"],
  "CRYPTO":   ["RIOT","MARA","HUT","CLSK","COIN","MSTR","BTC","ETH"],
  "ENERGY":   ["XOM","CVX","COP","OXY","SLB","HAL","BP"],
  "HEALTH":   ["JNJ","PFE","ABBV","LLY","MRK","UNH","MRNA","AMGN","GILD"],
  "CONSUMER": ["WMT","COST","TGT","HD","LOW","NKE","SBUX","MCD"],
  "DEFENSE":  ["RCAT","LMT","RTX","NOC","BA","GD"],
  "ETF":      ["SPY","QQQ","IWM","DIA","GLD","TLT","XLK","XLF","XLE"],
}

const SECTOR_KEYS = Object.keys(SECTORS) as (keyof typeof SECTORS)[]

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (ms < 0) return "just now"
  if (h > 48) return `${Math.floor(h / 24)}d ago`
  if (h > 0) return `${h}h ago`
  return `${m}m ago`
}

function sentiment(headline: string): "bullish" | "bearish" | null {
  const h = headline.toLowerCase()
  if (/beat|surge|jump|rally|gain|soar|record|profit|bullish|rise|up|high|strong|beat|top/.test(h)) return "bullish"
  if (/miss|fall|drop|crash|loss|cut|warn|bearish|decline|down|low|weak|layoff|bankrupt/.test(h)) return "bearish"
  return null
}

function groupEarningsByDate(earnings: EarningsItem[]) {
  const today = new Date().toISOString().slice(0, 10)
  const buckets: Record<string, EarningsItem[]> = {}
  for (const e of earnings) {
    if (e.reportDate < today) continue
    const key = e.reportDate
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(e)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 14)
}

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export default function NewsPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [earnings, setEarnings] = useState<EarningsItem[]>([])
  const [hasEarningsKey, setHasEarningsKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sector, setSector] = useState<string>("ALL")
  const [sentiment_, setSentiment] = useState<"all" | "bullish" | "bearish">("all")
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [searchLoading, setSearchLoading] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const loadNews = useCallback(async (symbolOverride?: string) => {
    setLoading(true)
    try {
      const url = symbolOverride
        ? `/api/news?symbols=${symbolOverride}&limit=80`
        : `/api/news?limit=80`
      const res = await fetch(url)
      const json = await res.json()
      setArticles(json.news ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadEarnings = useCallback(async () => {
    const res = await fetch("/api/earnings")
    const json = await res.json()
    setEarnings(json.earnings ?? [])
    setHasEarningsKey(json.hasKey)
  }, [])

  useEffect(() => {
    loadNews()
    loadEarnings()
  }, [loadNews, loadEarnings])

  // Auto-refresh news every 5 minutes
  useEffect(() => {
    const id = setInterval(() => loadNews(search || undefined), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [loadNews, search])

  async function handleSearch() {
    const s = searchInput.trim().toUpperCase()
    if (!s) { setSearch(""); loadNews(); return }
    setSearch(s)
    setSearchLoading(true)
    await loadNews(s)
    setSearchLoading(false)
  }

  function clearSearch() {
    setSearch("")
    setSearchInput("")
    loadNews()
  }

  const sectorSet = sector !== "ALL" ? new Set(SECTORS[sector] ?? []) : null

  const filtered = articles.filter(a => {
    if (sectorSet && sectorSet.size > 0) {
      if (!a.symbols.some(s => sectorSet.has(s))) return false
    }
    if (sentiment_ !== "all") {
      const s = sentiment(a.headline)
      if (sentiment_ === "bullish" && s !== "bullish") return false
      if (sentiment_ === "bearish" && s !== "bearish") return false
    }
    return true
  })

  const earningsBuckets = groupEarningsByDate(earnings)

  return (
    <div className="p-6 h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Market News</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {articles.length} articles · {[...new Set(articles.map(a => a.source))].length} sources · auto-refreshes 5m
          </p>
        </div>
        <button
          onClick={() => loadNews(search || undefined)}
          className="text-[10px] tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
        >
          REFRESH
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-1 border border-border rounded overflow-hidden bg-secondary flex-1 max-w-xs">
          <input
            ref={searchRef}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="SEARCH TICKER OR KEYWORD..."
            className="text-[10px] tracking-widest bg-transparent px-2 py-1.5 text-foreground placeholder:text-muted-foreground flex-1 outline-none uppercase"
          />
          {search && (
            <button onClick={clearSearch} className="px-2 text-muted-foreground hover:text-foreground text-xs">×</button>
          )}
        </div>
        <button
          onClick={handleSearch}
          disabled={searchLoading}
          className="text-[10px] tracking-widest border border-border rounded px-2 py-1.5 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
        >
          {searchLoading ? "..." : "GO"}
        </button>

        {/* Sentiment filter */}
        <div className="flex rounded border border-border overflow-hidden ml-2">
          {(["all", "bullish", "bearish"] as const).map(f => (
            <button
              key={f}
              onClick={() => setSentiment(f)}
              className={`px-2 py-1 text-[9px] tracking-widest transition-colors ${
                sentiment_ === f
                  ? f === "bullish" ? "bg-primary text-primary-foreground"
                    : f === "bearish" ? "bg-red-400/80 text-white"
                    : "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <span className="text-[10px] text-muted-foreground ml-auto">{filtered.length} results</span>
      </div>

      {/* Sector filter */}
      <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0">
        {["ALL", ...SECTOR_KEYS].map(s => (
          <button
            key={s}
            onClick={() => setSector(s)}
            className={`text-[9px] tracking-widest px-2 py-0.5 rounded border transition-colors ${
              sector === s
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Main content: news + earnings */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* News feed */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {search && (
            <div className="text-[10px] text-primary tracking-widest pb-1 border-b border-border">
              SHOWING NEWS FOR: {search}
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-40 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
              NO RESULTS
            </div>
          ) : (
            filtered.map(a => {
              const s = sentiment(a.headline)
              return (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 border border-border rounded p-3 hover:border-primary/30 hover:bg-secondary/20 transition-colors group"
                >
                  {/* Sentiment bar */}
                  <div className={`w-0.5 self-stretch rounded-full flex-shrink-0 ${
                    s === "bullish" ? "bg-primary" : s === "bearish" ? "bg-red-400" : "bg-border"
                  }`} />

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground leading-snug group-hover:text-primary transition-colors">
                      {a.headline}
                    </p>
                    {a.summary && (
                      <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                        {a.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {a.symbols.slice(0, 5).map(sym => (
                        <button
                          key={sym}
                          onClick={e => { e.preventDefault(); setSearchInput(sym); setSearch(sym); loadNews(sym) }}
                          className="text-[9px] text-primary tracking-widest font-medium hover:underline"
                        >
                          {sym}
                        </button>
                      ))}
                      <span className="text-[9px] text-muted-foreground">{a.source}</span>
                      {s && (
                        <span className={`text-[9px] border rounded px-1 tracking-widest ml-auto ${
                          s === "bullish" ? "text-primary border-primary/30" : "text-red-400 border-red-400/30"
                        }`}>
                          {s.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-[9px] text-muted-foreground flex-shrink-0 tabular-nums whitespace-nowrap">
                    {timeAgo(a.publishedAt)}
                  </span>
                </a>
              )
            })
          )}
        </div>

        {/* Earnings calendar sidebar */}
        <div className="w-56 flex-shrink-0 overflow-y-auto">
          <div className="sticky top-0 bg-background pb-2 mb-2 border-b border-border">
            <p className="text-[10px] text-muted-foreground tracking-widest">EARNINGS CALENDAR</p>
          </div>

          {!hasEarningsKey ? (
            <div className="space-y-2">
              <div className="border border-dashed border-border rounded p-3 text-center">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Add <code className="text-primary">ALPHA_VANTAGE_KEY</code> to env for earnings calendar
                </p>
              </div>
              <a
                href="https://www.alphavantage.co/support/#api-key"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-primary tracking-widest block text-center hover:underline"
              >
                GET FREE KEY →
              </a>
            </div>
          ) : earningsBuckets.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No upcoming earnings</p>
          ) : (
            <div className="space-y-4">
              {earningsBuckets.map(([date, items]) => (
                <div key={date}>
                  <p className="text-[9px] text-primary tracking-widest mb-1.5">{formatDate(date)}</p>
                  <div className="space-y-1">
                    {items.slice(0, 8).map(e => (
                      <div key={e.symbol} className="border border-border rounded px-2 py-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-medium text-foreground tracking-wide">{e.symbol}</span>
                          {e.estimate && (
                            <span className="text-[9px] text-muted-foreground">est {e.estimate}</span>
                          )}
                        </div>
                        <p className="text-[9px] text-muted-foreground truncate">{e.name}</p>
                      </div>
                    ))}
                    {items.length > 8 && (
                      <p className="text-[9px] text-muted-foreground text-right">+{items.length - 8} more</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
