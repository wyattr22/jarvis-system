// Delayed futures quotes via Yahoo continuous contracts.
// Alpaca has NO futures data at any tier (probed 2026-07-05); free real-time
// CME data does not legally exist. Quotes carry meta.delaySeconds=900 and the
// UI pairs each with its real-time ETF proxy (see instruments/proxies.ts).

import { getYahooQuotes } from "./yahoo"
import { FUTURES_CATALOG } from "@/lib/instruments/proxies"
import type { MarketQuote } from "./freshness"

export async function getFuturesQuotes(): Promise<MarketQuote[]> {
  return getYahooQuotes(FUTURES_CATALOG.map(f => f.future), "yahoo.futures", 60)
}
