import { safeFetch } from "@/lib/sandbox/whitelist"

// Symbols: ^DXY (dollar), ^TNX (10Y yield %), GC=F (gold), CL=F (crude oil), SI=F (silver)
export interface IntermarketSnapshot {
  dxy: number | null      // US Dollar Index
  yield10y: number | null // 10Y Treasury yield %
  gold: number | null     // Gold $/oz
  oil: number | null      // Crude oil $/barrel
  silver: number | null
}

async function fetchYahooQuote(symbol: string): Promise<number | null> {
  try {
    const encoded = encodeURIComponent(symbol)
    const res = await safeFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=2d`,
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

export async function getIntermarketSnapshot(): Promise<IntermarketSnapshot> {
  const [dxy, yield10y, gold, oil, silver] = await Promise.all([
    fetchYahooQuote("^DXY"),
    fetchYahooQuote("^TNX"),
    fetchYahooQuote("GC=F"),
    fetchYahooQuote("CL=F"),
    fetchYahooQuote("SI=F"),
  ])
  return { dxy, yield10y, gold, oil, silver }
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