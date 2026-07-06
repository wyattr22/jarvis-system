// Finnhub provider (Phase 11.3). Free-tier reality probed 2026-07-05 with
// the project key:
//   ✅ /quote (US equities, real-time)    ✅ /calendar/earnings
//   ✅ /search (symbol lookup)            ❌ ALL forex endpoints (paywalled)
// Forex therefore stays on Yahoo PAIR=X (see api/quote dispatch + /markets
// forex grid). Rate limit: 60 req/min hard; budgeter caps us at 55.

import { safeFetch } from "@/lib/sandbox/whitelist"
import { metaFor, type MarketQuote } from "./freshness"
import { cachedQuote } from "./quote-cache"
import { cached } from "@/lib/cache/redis"
import { underBudget } from "./budget"
import type { EarningsItem } from "./earnings"

const BASE = "https://finnhub.io/api/v1"

function token(): string | null {
  return process.env.FINNHUB_API_KEY ?? null
}

export function hasFinnhubKey(): boolean {
  return Boolean(token())
}

interface FinnhubQuote {
  c: number  // current
  d: number | null  // change
  dp: number | null // change percent
  t: number  // unix seconds
}

/** Real-time US equity quote. Returns null without a key or on failure. */
export async function getFinnhubQuote(symbol: string): Promise<MarketQuote | null> {
  const key = token()
  if (!key) return null
  try {
    const { value } = await cachedQuote("finnhub", `finnhub:quote:${symbol}`, 10, async () => {
      const res = await safeFetch(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`finnhub quote error: ${res.status}`)
      const q: FinnhubQuote = await res.json()
      if (!q.c || q.c <= 0) throw new Error(`finnhub: no price for ${symbol}`)
      const quote: MarketQuote = {
        symbol,
        price: q.c,
        changePct: q.dp ?? null,
        meta: metaFor("finnhub.quote", new Date(q.t * 1000).toISOString()),
      }
      return quote
    })
    return value
  } catch {
    return null
  }
}

interface FinnhubEarningsRow {
  symbol: string
  date: string
  epsEstimate: number | null
  quarter: number
  year: number
}

/**
 * Earnings calendar for the next `horizonDays`, mapped to the legacy
 * EarningsItem shape so existing consumers don't change. Cached 1h in Redis.
 */
export async function getFinnhubEarnings(horizonDays = 14): Promise<EarningsItem[]> {
  const key = token()
  if (!key) return []
  try {
    const from = new Date().toISOString().split("T")[0]
    const to = new Date(Date.now() + horizonDays * 86400000).toISOString().split("T")[0]
    return await cached(`finnhub:earnings:${from}:${to}`, 3600, async () => {
      if (!(await underBudget("finnhub"))) throw new Error("finnhub over budget")
      const res = await safeFetch(`${BASE}/calendar/earnings?from=${from}&to=${to}&token=${key}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`finnhub earnings error: ${res.status}`)
      const json = await res.json()
      const rows: FinnhubEarningsRow[] = json.earningsCalendar ?? []
      return mapFinnhubEarnings(rows)
    })
  } catch {
    return []
  }
}

// Exported for tests — pure mapper to the legacy shape.
export function mapFinnhubEarnings(rows: FinnhubEarningsRow[]): EarningsItem[] {
  return rows
    .filter(r => r.symbol && r.date)
    .map(r => ({
      symbol: r.symbol,
      name: r.symbol, // Finnhub calendar has no company name; symbol suffices
      reportDate: r.date,
      fiscalDateEnding: `Q${r.quarter} ${r.year}`,
      estimate: r.epsEstimate !== null && r.epsEstimate !== undefined ? String(r.epsEstimate) : "",
      currency: "USD",
    }))
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
}

export interface FinnhubSearchResult {
  symbol: string
  description: string
  type: string
}

/** Symbol search fallback for the universe typeahead. */
export async function searchFinnhubSymbols(query: string): Promise<FinnhubSearchResult[]> {
  const key = token()
  if (!key || !query.trim()) return []
  try {
    if (!(await underBudget("finnhub"))) return []
    const res = await safeFetch(`${BASE}/search?q=${encodeURIComponent(query)}&token=${key}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const json = await res.json()
    return (json.result ?? []).slice(0, 10)
  } catch {
    return []
  }
}
