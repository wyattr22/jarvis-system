// Intermarket macro snapshot for LLM context. Since 11.5 this consumes the
// shared Yahoo fetcher (budget-aware, stale-shadow cached) instead of its own
// scrape, and the dollar index uses DX-Y.NYB — the old ^DXY symbol is dead on
// Yahoo (price=None, 2019 timestamp), so `dxy` had been silently null.

import { getYahooQuote } from "./yahoo"

export interface IntermarketSnapshot {
  dxy: number | null      // US Dollar Index
  yield10y: number | null // 10Y Treasury yield %
  gold: number | null     // Gold $/oz
  oil: number | null      // Crude oil $/barrel
  silver: number | null
}

export async function getIntermarketSnapshot(): Promise<IntermarketSnapshot> {
  const [dxy, yield10y, gold, oil, silver] = await Promise.all([
    getYahooQuote("DX-Y.NYB", "yahoo.index", 300),
    getYahooQuote("^TNX", "yahoo.index", 300),
    getYahooQuote("GC=F", "yahoo.futures", 300),
    getYahooQuote("CL=F", "yahoo.futures", 300),
    getYahooQuote("SI=F", "yahoo.futures", 300),
  ])
  return {
    dxy: dxy?.price ?? null,
    yield10y: yield10y?.price ?? null,
    gold: gold?.price ?? null,
    oil: oil?.price ?? null,
    silver: silver?.price ?? null,
  }
}

export function formatIntermarketForContext(snap: IntermarketSnapshot): string {
  const parts: string[] = []
  if (snap.dxy !== null) parts.push(`DXY ${snap.dxy.toFixed(1)}`)
  if (snap.yield10y !== null) parts.push(`10Y yield ${snap.yield10y.toFixed(2)}%`)
  if (snap.gold !== null) parts.push(`Gold $${snap.gold.toLocaleString("en-US", { maximumFractionDigits: 0 })}`)
  if (snap.oil !== null) parts.push(`Oil $${snap.oil.toFixed(1)}/bbl`)
  if (snap.silver !== null) parts.push(`Silver $${snap.silver.toFixed(1)}`)
  return parts.join(" | ")
}
