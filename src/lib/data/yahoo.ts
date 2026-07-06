// Shared Yahoo Finance chart-API fetcher (unofficial, brittle — every caller
// gets a MarketQuote with honest delayed metadata and rides the stale-shadow
// cache so a Yahoo outage degrades to "stale + badge", never a blank tile).
//
// NOTE: Yahoo's dollar-index symbol is DX-Y.NYB. `^DXY` resolves but returns
// price=None with a 2019 timestamp — it silently broke the old intermarket
// dxy field.

import { safeFetch } from "@/lib/sandbox/whitelist"
import { metaFor, type MarketQuote } from "./freshness"
import { cachedQuote } from "./quote-cache"

interface YahooChartMeta {
  symbol?: string
  regularMarketPrice?: number
  chartPreviousClose?: number
  regularMarketTime?: number
}

async function fetchChartMeta(symbol: string): Promise<YahooChartMeta | null> {
  const encoded = encodeURIComponent(symbol)
  const res = await safeFetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=2d`,
    {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Jarvis/2.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  )
  if (!res.ok) return null
  const json = await res.json()
  return json.chart?.result?.[0]?.meta ?? null
}

// Exported for tests — pure mapper.
export function mapChartMetaToQuote(
  symbol: string,
  meta: YahooChartMeta,
  source: string,
): MarketQuote | null {
  const price = meta.regularMarketPrice
  if (typeof price !== "number" || price <= 0) return null
  const prev = meta.chartPreviousClose
  const changePct = typeof prev === "number" && prev > 0 ? ((price - prev) / prev) * 100 : null
  const asOf = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : ""
  return { symbol, price, changePct, meta: metaFor(source, asOf) }
}

/**
 * Quote one Yahoo symbol through the budget-aware cache.
 * `source` should be "yahoo.futures" or "yahoo.index" so freshness metadata
 * and quality tracking stay per-category.
 */
export async function getYahooQuote(
  symbol: string,
  source: string,
  ttlSeconds = 60,
): Promise<MarketQuote | null> {
  try {
    const { value } = await cachedQuote("yahoo", `yahoo:${symbol}`, ttlSeconds, async () => {
      const meta = await fetchChartMeta(symbol)
      const quote = meta ? mapChartMetaToQuote(symbol, meta, source) : null
      if (!quote) throw new Error(`yahoo: no price for ${symbol}`)
      return quote
    })
    return value
  } catch {
    return null
  }
}

export async function getYahooQuotes(
  symbols: string[],
  source: string,
  ttlSeconds = 60,
): Promise<MarketQuote[]> {
  const results = await Promise.all(symbols.map(s => getYahooQuote(s, source, ttlSeconds)))
  return results.filter((q): q is MarketQuote => q !== null)
}
