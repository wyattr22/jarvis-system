// Markets MCP tools (11.10) — Claude clients get the same full-visibility
// aggregate as the /markets dashboard, with freshness `meta` on every number
// so the honesty contract survives the protocol boundary.

import { z, registerTool } from "@/lib/mcp/server"
import { getIndexQuotes } from "@/lib/data/indexes"
import { getFuturesQuotes } from "@/lib/data/futures"
import { getIntermarketSnapshot } from "@/lib/data/intermarket"
import { getMovers, getSectorETFs, getMarketQuotes } from "@/lib/data/alpaca"
import { getOptionsSnapshot } from "@/lib/data/options"
import { getYahooQuote } from "@/lib/data/yahoo"
import { FUTURES_CATALOG } from "@/lib/instruments/proxies"
import { parseInstrument } from "@/lib/instruments/parse"

registerTool({
  name: "markets.overview",
  description:
    "Full market visibility snapshot: index levels, futures (delayed ~15m, each with its real-time ETF proxy), macro (DXY/10Y/gold/oil/silver), 11 SPDR sector day-changes, whole-market top movers, and SPY options positioning (max pain, P/C, GEX). Every quote carries meta {source, asOf, delaySeconds, realtime} — respect it: delayed values are context, not signal timing.",
  inputSchema: z.object({}),
  requiredScope: "read:signals",
  handler: async () => {
    const proxySymbols = FUTURES_CATALOG.map(f => f.proxy).filter((p): p is string => p !== null)
    const [indexes, futures, proxies, macro, sectors, movers, spyOptions] = await Promise.all([
      getIndexQuotes().catch(() => []),
      getFuturesQuotes().catch(() => []),
      getMarketQuotes(proxySymbols).catch(() => []),
      getIntermarketSnapshot().catch(() => null),
      getSectorETFs().catch(() => ({})),
      getMovers(5).catch(() => null),
      getOptionsSnapshot("SPY").catch(() => null),
    ])
    const proxyBySymbol = new Map(proxies.map(q => [q.symbol, q]))
    return {
      indexes,
      futures: FUTURES_CATALOG.flatMap(spec => {
        const fut = futures.find(q => q.symbol === spec.future)
        if (!fut) return []
        return [{
          ...fut,
          label: spec.label,
          proxy: spec.proxy ? proxyBySymbol.get(spec.proxy) ?? null : null,
        }]
      }),
      macro,
      sectors,
      movers,
      options_pulse: spyOptions,
    }
  },
})

registerTool({
  name: "markets.quote",
  description:
    "Quote any instrument across asset classes. Equity/crypto tickers hit Alpaca IEX (real-time), forex pairs (EURUSD, EUR/USD) and futures (ES=F, ESU26) hit Yahoo (delayed ~15m). Returns a MarketQuote with freshness meta.",
  inputSchema: z.object({ symbol: z.string().min(1).max(30) }),
  requiredScope: "read:signals",
  handler: async (input: { symbol: string }) => {
    const parsed = parseInstrument(input.symbol)
    switch (parsed.assetClass) {
      case "forex": {
        const q = await getYahooQuote(`${parsed.underlying.replace("/", "")}=X`, "yahoo.forex", 60)
        return q ? { ...q, symbol: parsed.underlying } : { error: `no forex quote for ${parsed.underlying}` }
      }
      case "futures": {
        const sym = parsed.raw.toUpperCase().endsWith("=F") ? parsed.raw.toUpperCase() : `${parsed.underlying}=F`
        return (await getYahooQuote(sym, "yahoo.futures", 60)) ?? { error: `no futures quote for ${sym}` }
      }
      default: {
        const [q] = await getMarketQuotes([parsed.underlying])
        return q ?? { error: `no quote for ${parsed.underlying}` }
      }
    }
  },
})
