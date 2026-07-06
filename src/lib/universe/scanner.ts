// Whole-market scanner (12.3): sees the ENTIRE US-equity tape every scan and
// distills it into a rotating tradeable universe.
//
//   1. Full active-equity list from Alpaca /v2/assets (~11k, cached 24h)
//   2. Daily bars for ALL of them via multi-symbol batches (200/call ≈ 55
//      calls, inside the 180/min budget)
//   3. Hard filters: price band, minimum average dollar volume
//   4. Score = liquidity + volatility + momentum ranks; today's movers get
//      a boost so fresh action always rotates in
//   5. Top N replace scan_universe wholesale
//
// Pure scoring/filtering functions are exported for tests.

import { safeFetch } from "@/lib/sandbox/whitelist"
import { getEquityUniverse } from "@/lib/instruments/universe"
import { getMovers } from "@/lib/data/alpaca"
import { replaceUniverse, type UniverseRow } from "./store"

const DATA_BASE = "https://data.alpaca.markets/v2"
const BATCH_SIZE = 200

// Filter thresholds — deliberately wide: the point is opportunity, the
// allocator/risk layer decides what's actually tradeable.
export const FILTERS = {
  minPrice: 1,
  maxPrice: 1000,
  minAvgDollarVolume: 5_000_000, // $5M/day keeps spreads sane
  universeSize: 150,
}

interface DailyBar { c: number; h: number; l: number; o: number; v: number; t: string }

export interface SymbolStats {
  symbol: string
  price: number
  avgDollarVolume: number
  atrPct: number
  changePct: number
}

function headers() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  }
}

async function fetchDailyBarsBatch(symbols: string[], start: string): Promise<Record<string, DailyBar[]>> {
  const url = `${DATA_BASE}/stocks/bars?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&timeframe=1Day&start=${start}&feed=iex&limit=10000`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`bars batch error: ${res.status}`)
  const json = await res.json()
  return json.bars ?? {}
}

// Exported for tests — pure per-symbol stats from daily bars.
export function statsFromBars(symbol: string, bars: DailyBar[]): SymbolStats | null {
  if (bars.length < 3) return null
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  if (!last.c || last.c <= 0 || !prev.c) return null
  const avgDollarVolume = bars.reduce((s, b) => s + b.c * b.v, 0) / bars.length
  // ATR% ≈ mean true-range / price over the window
  let trSum = 0
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    )
    trSum += tr
  }
  const atrPct = (trSum / (bars.length - 1)) / last.c * 100
  const changePct = ((last.c - prev.c) / prev.c) * 100
  return { symbol, price: last.c, avgDollarVolume, atrPct, changePct }
}

// Exported for tests — pure filter.
export function passesFilters(s: SymbolStats, f = FILTERS): boolean {
  return s.price >= f.minPrice && s.price <= f.maxPrice && s.avgDollarVolume >= f.minAvgDollarVolume
}

// Exported for tests — rank-based composite score. Higher = better.
// Liquidity keeps us executable, volatility is where R lives, |momentum|
// finds what's moving NOW; mover bonus guarantees today's action rotates in.
export function scoreUniverse(
  candidates: SymbolStats[],
  moverSymbols: Set<string>,
): Omit<UniverseRow, "scanned_at">[] {
  const byVolume = [...candidates].sort((a, b) => b.avgDollarVolume - a.avgDollarVolume)
  const byAtr = [...candidates].sort((a, b) => b.atrPct - a.atrPct)
  const byMove = [...candidates].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
  const rankOf = (arr: SymbolStats[]) => new Map(arr.map((s, i) => [s.symbol, i]))
  const volRank = rankOf(byVolume)
  const atrRank = rankOf(byAtr)
  const moveRank = rankOf(byMove)
  const n = candidates.length

  const scored = candidates.map(s => {
    // Normalized 0..1 (1 = best rank)
    const liq = 1 - (volRank.get(s.symbol) ?? n) / n
    const vol = 1 - (atrRank.get(s.symbol) ?? n) / n
    const mom = 1 - (moveRank.get(s.symbol) ?? n) / n
    const moverBonus = moverSymbols.has(s.symbol) ? 0.15 : 0
    const score = 0.4 * liq + 0.35 * vol + 0.25 * mom + moverBonus
    const reasons: string[] = []
    if (liq > 0.8) reasons.push("high liquidity")
    if (vol > 0.8) reasons.push("high volatility")
    if (mom > 0.8) reasons.push("strong move")
    if (moverBonus) reasons.push("top mover today")
    return { stats: s, score, reason: reasons.join(", ") || "balanced" }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .map((x, i) => ({
      symbol: x.stats.symbol,
      rank: i + 1,
      score: Number(x.score.toFixed(4)),
      price: x.stats.price,
      dollar_volume: Math.round(x.stats.avgDollarVolume),
      atr_pct: Number(x.stats.atrPct.toFixed(2)),
      change_pct: Number(x.stats.changePct.toFixed(2)),
      reason: x.reason,
    }))
}

export interface ScanResult {
  scanned: number
  passedFilters: number
  universeSize: number
  batches: number
  tookMs: number
}

/** Run the full-market scan and replace scan_universe. */
export async function runMarketScan(): Promise<ScanResult> {
  const started = Date.now()
  const assets = await getEquityUniverse() // [symbol, name][]
  const symbols = assets.map(([s]) => s).filter(s => /^[A-Z]{1,5}$/.test(s)) // skip units/warrants/weird suffixes
  const start = new Date(Date.now() - 10 * 86400000).toISOString().split("T")[0]

  const allStats: SymbolStats[] = []
  let batches = 0
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE)
    try {
      const bars = await fetchDailyBarsBatch(batch, start)
      for (const [sym, b] of Object.entries(bars)) {
        const stats = statsFromBars(sym, b)
        if (stats && passesFilters(stats)) allStats.push(stats)
      }
    } catch { /* one bad batch shouldn't kill the scan */ }
    batches++
    // stay well under 180 req/min
    if (batches % 100 === 0) await new Promise(r => setTimeout(r, 5_000))
  }

  const movers = await getMovers(20).catch(() => null)
  const moverSymbols = new Set<string>(
    [...(movers?.gainers ?? []), ...(movers?.losers ?? [])].map(m => m.symbol),
  )

  const ranked = scoreUniverse(allStats, moverSymbols).slice(0, FILTERS.universeSize)
  await replaceUniverse(ranked)

  return {
    scanned: symbols.length,
    passedFilters: allStats.length,
    universeSize: ranked.length,
    batches,
    tookMs: Date.now() - started,
  }
}
