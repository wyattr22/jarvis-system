import { safeFetch } from "@/lib/sandbox/whitelist"
import { metaFor, type MarketQuote } from "./freshness"

const BASE = "https://data.alpaca.markets/v2"
const TRADE_BASE = process.env.ALPACA_PAPER === "true"
  ? "https://paper-api.alpaca.markets"
  : "https://api.alpaca.markets"

function headers() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  }
}

export interface Bar {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number
  vw: number
}

export interface Quote {
  symbol: string
  bid: number
  ask: number
  mid: number
  timestamp: string
}

export async function getBars(
  symbol: string,
  timeframe: string,
  limit = 200,
  daysBack = 60
): Promise<Bar[]> {
  const start = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  // sort=desc gets the MOST RECENT bars first, then we reverse so callers get ascending order
  // feed=iex is the free tier feed; adjustment=raw ensures split-adjusted prices are consistent
  const url = `${BASE}/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}&start=${start}&sort=desc&feed=iex&adjustment=split`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Alpaca bars error: ${res.status}`)
  const json = await res.json()
  const bars: Bar[] = json.bars ?? []
  return bars.reverse()
}

export async function getLatestQuote(symbol: string): Promise<Quote> {
  const url = `${BASE}/stocks/snapshots?symbols=${encodeURIComponent(symbol)}&feed=iex`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Alpaca snapshot error: ${res.status}`)
  const json = await res.json()
  const snap = json[symbol]
  if (!snap) throw new Error(`No snapshot for ${symbol}`)
  // latestTrade.p is the actual last executed price — accurate in pre/post-market too
  const tradePrice: number = snap.latestTrade?.p ?? 0
  const bid: number = snap.latestQuote?.bp ?? tradePrice
  const ask: number = snap.latestQuote?.ap ?? tradePrice
  return {
    symbol,
    bid,
    ask,
    mid: tradePrice > 0 ? tradePrice : (bid + ask) / 2,
    timestamp: snap.latestTrade?.t ?? snap.latestQuote?.t ?? '',
  }
}

// Batch snapshot fetch — single API call for multiple symbols
export async function getMultipleQuotes(symbols: string[]): Promise<Quote[]> {
  if (!symbols.length) return []
  const url = `${BASE}/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(','))}&feed=iex`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Alpaca batch snapshot error: ${res.status}`)
  const json = await res.json()
  return symbols.map(symbol => {
    const snap = json[symbol]
    if (!snap) return { symbol, bid: 0, ask: 0, mid: 0, timestamp: '' }
    const tradePrice: number = snap.latestTrade?.p ?? 0
    const bid: number = snap.latestQuote?.bp ?? tradePrice
    const ask: number = snap.latestQuote?.ap ?? tradePrice
    return {
      symbol,
      bid,
      ask,
      mid: tradePrice > 0 ? tradePrice : (bid + ask) / 2,
      timestamp: snap.latestTrade?.t ?? snap.latestQuote?.t ?? '',
    }
  })
}

// MarketQuote variant with freshness metadata (Phase 11). Additive — the
// legacy Quote shape above stays untouched for existing consumers.
export async function getMarketQuotes(symbols: string[]): Promise<MarketQuote[]> {
  if (!symbols.length) return []
  const url = `${BASE}/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(','))}&feed=iex`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Alpaca batch snapshot error: ${res.status}`)
  const json = await res.json()
  return symbols.flatMap(symbol => {
    const snap = json[symbol]
    if (!snap) return []
    return [mapSnapshotToMarketQuote(symbol, snap)]
  })
}

// Exported for tests — pure mapper from an Alpaca snapshot payload.
export function mapSnapshotToMarketQuote(
  symbol: string,
  snap: {
    latestTrade?: { p?: number; t?: string }
    latestQuote?: { bp?: number; ap?: number; t?: string }
    prevDailyBar?: { c?: number }
  },
): MarketQuote {
  const tradePrice = snap.latestTrade?.p ?? 0
  const bid = snap.latestQuote?.bp ?? tradePrice
  const ask = snap.latestQuote?.ap ?? tradePrice
  const price = tradePrice > 0 ? tradePrice : (bid + ask) / 2
  const prevClose = snap.prevDailyBar?.c
  const changePct = prevClose && prevClose > 0 && price > 0
    ? ((price - prevClose) / prevClose) * 100
    : null
  return {
    symbol,
    price,
    changePct,
    bid,
    ask,
    meta: metaFor("alpaca.iex", snap.latestTrade?.t ?? snap.latestQuote?.t ?? ""),
  }
}

export async function getPositions() {
  const res = await safeFetch(`${TRADE_BASE}/v2/positions`, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`Alpaca positions error: ${res.status}`)
  return res.json()
}

export async function getAccount() {
  const res = await safeFetch(`${TRADE_BASE}/v2/account`, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`Alpaca account error: ${res.status}`)
  return res.json()
}

export async function getOrders(status = "all", limit = 50) {
  const res = await safeFetch(
    `${TRADE_BASE}/v2/orders?status=${status}&limit=${limit}&direction=desc`,
    { headers: headers(), cache: "no-store" }
  )
  if (!res.ok) throw new Error(`Alpaca orders error: ${res.status}`)
  return res.json()
}

export async function getAlpacaNews(symbols: string[], limit = 10) {
  const syms = symbols.join(",")
  const url = `${BASE}/news?symbols=${syms}&limit=${limit}`
  const res = await safeFetch(url, { headers: headers(), next: { revalidate: 300 } })
  if (!res.ok) throw new Error(`Alpaca news error: ${res.status}`)
  const json = await res.json()
  return json.news ?? []
}

export async function getBTCPrice(): Promise<{ price: number; change24h: number } | null> {
  try {
    const res = await safeFetch(
      "https://data.alpaca.markets/v1beta3/crypto/us/latest/bars?symbols=BTC%2FUSD",
      { headers: headers(), next: { revalidate: 60 } }
    )
    if (!res.ok) return null
    const json = await res.json()
    const bar = json.bars?.["BTC/USD"]
    if (!bar) return null
    // Fetch yesterday's bar for 24h change
    const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0]
    const histRes = await safeFetch(
      `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC%2FUSD&timeframe=1Day&start=${yesterday}&limit=2`,
      { headers: headers(), next: { revalidate: 3600 } }
    )
    let change24h = 0
    if (histRes.ok) {
      const histJson = await histRes.json()
      const histBars = histJson.bars?.["BTC/USD"] ?? []
      if (histBars.length >= 1) {
        change24h = (bar.c - histBars[histBars.length - 1].c) / histBars[histBars.length - 1].c * 100
      }
    }
    return { price: bar.c, change24h }
  } catch {
    return null
  }
}

export async function getVIX(): Promise<number | null> {
  try {
    // Use Yahoo Finance for real VIX (Alpaca doesn't carry index data)
    const res = await safeFetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=2d",
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Jarvis/2.0)" },
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) return null
    const json = await res.json()
    const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[] | undefined
    if (!closes?.length) return null
    return closes[closes.length - 1]
  } catch {
    return null
  }
}

// Whole-market top movers from Alpaca's free screener (real-time IEX).
// Covers small caps naturally — the screener scans the entire tape.
export interface Mover {
  symbol: string
  price: number
  change: number
  percentChange: number
}

export interface MoversSnapshot {
  gainers: Mover[]
  losers: Mover[]
  meta: import("./freshness").QuoteMeta
}

export async function getMovers(top = 10): Promise<MoversSnapshot | null> {
  try {
    const url = `https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=${top}`
    const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json()
    const map = (m: { symbol: string; price: number; change: number; percent_change: number }): Mover => ({
      symbol: m.symbol,
      price: m.price,
      change: m.change,
      percentChange: m.percent_change,
    })
    return {
      gainers: (json.gainers ?? []).map(map),
      losers: (json.losers ?? []).map(map),
      meta: metaFor("alpaca.iex", json.last_updated ?? ""),
    }
  } catch {
    return null
  }
}

export async function getSectorETFs(): Promise<Record<string, number>> {
  // All 11 SPDR sector ETFs + SPY benchmark
  const etfs = ["SPY", "XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLC", "XLP", "XLU", "XLRE", "XLB"]
  const results: Record<string, number> = {}

  await Promise.allSettled(
    etfs.map(async (etf) => {
      try {
        // 2 daily bars → compute day-over-day change
        const bars = await getBars(etf, "1Day", 3, 10)
        if (bars.length >= 2) {
          const today = bars[bars.length - 1]
          const prev = bars[bars.length - 2]
          results[etf] = (today.c - prev.c) / prev.c * 100
        } else if (bars.length === 1) {
          results[etf] = (bars[0].c - bars[0].o) / bars[0].o * 100
        }
      } catch { /* ignore */ }
    })
  )

  return results
}