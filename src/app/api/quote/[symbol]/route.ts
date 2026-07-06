// Multi-asset quote endpoint (11.8): dispatches by parsed asset class.
//   equity/crypto -> Alpaca IEX (real-time)
//   forex         -> Yahoo `PAIR=X` (until the Finnhub provider lands in 11.3)
//   futures/index -> Yahoo (delayed)
// Always returns a MarketQuote (+ legacy bid/ask/mid fields for old callers).
// Forex symbols arrive URL-safe as EURUSD or EUR_USD.

import { getMarketQuotes } from "@/lib/data/alpaca"
import { getYahooQuote } from "@/lib/data/yahoo"
import { parseInstrument } from "@/lib/instruments/parse"
import type { MarketQuote } from "@/lib/data/freshness"

function withLegacyFields(q: MarketQuote) {
  return { ...q, mid: q.price, bid: q.bid ?? q.price, ask: q.ask ?? q.price }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const parsed = parseInstrument(decodeURIComponent(symbol))

  try {
    switch (parsed.assetClass) {
      case "forex": {
        const compact = parsed.underlying.replace("/", "")
        const q = await getYahooQuote(`${compact}=X`, "yahoo.forex", 60)
        if (!q) return Response.json({ error: `no forex quote for ${parsed.underlying}` }, { status: 502 })
        return Response.json(withLegacyFields({ ...q, symbol: parsed.underlying }))
      }
      case "futures": {
        const yahooSymbol = parsed.raw.toUpperCase().endsWith("=F")
          ? parsed.raw.toUpperCase()
          : `${parsed.underlying}=F`
        const q = await getYahooQuote(yahooSymbol, "yahoo.futures", 60)
        if (!q) return Response.json({ error: `no futures quote for ${yahooSymbol}` }, { status: 502 })
        return Response.json(withLegacyFields(q))
      }
      default: {
        const [q] = await getMarketQuotes([parsed.underlying])
        if (!q) return Response.json({ error: `no quote for ${parsed.underlying}` }, { status: 502 })
        return Response.json(withLegacyFields(q))
      }
    }
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 })
  }
}
