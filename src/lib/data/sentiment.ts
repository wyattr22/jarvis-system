import { safeFetch } from "@/lib/sandbox/whitelist"

export interface TickerSentiment {
  symbol: string
  bullCount: number
  bearCount: number
  total: number
  bullPct: number
  watchlistCount: number
}

export async function getStockTwitsSentiment(symbol: string): Promise<TickerSentiment | null> {
  try {
    const res = await safeFetch(
      `https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`,
      {
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(4000),
      }
    )
    if (!res.ok) return null
    const json = await res.json()

    const messages: unknown[] = json.messages ?? []
    let bullCount = 0
    let bearCount = 0

    for (const msg of messages) {
      const sentiment = (msg as { entities?: { sentiment?: { basic?: string } } })
        .entities?.sentiment?.basic
      if (sentiment === "Bullish") bullCount++
      else if (sentiment === "Bearish") bearCount++
    }

    const total = bullCount + bearCount
    const bullPct = total > 0 ? Math.round((bullCount / total) * 100) : 0
    const watchlistCount: number = json.symbol?.watchlist_count ?? 0

    return {
      symbol: symbol.toUpperCase(),
      bullCount,
      bearCount,
      total,
      bullPct,
      watchlistCount,
    }
  } catch {
    return null
  }
}

export async function getMultiSentiment(symbols: string[]): Promise<TickerSentiment[]> {
  const limited = symbols.slice(0, 3)
  const results = await Promise.all(limited.map((s) => getStockTwitsSentiment(s)))
  return results.filter((r): r is TickerSentiment => r !== null)
}

export function formatSentimentForContext(sentiments: TickerSentiment[]): string {
  return sentiments
    .map((s) => {
      const watching =
        s.watchlistCount >= 1000
          ? `${(s.watchlistCount / 1000).toFixed(0)}k`
          : String(s.watchlistCount)
      return `${s.symbol}: ${s.bullPct}% bull (${s.total} msgs, ${watching} watching)`
    })
    .join(" | ")
}