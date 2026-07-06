// Index levels via Yahoo (delayed, labeled). Alpaca's new indices endpoint
// (June 2026) was probed 2026-07-05 with the project key: 403 "not authorized
// for index data" — it's a paid add-on, so Yahoo stays primary until that
// changes. Dollar index MUST be DX-Y.NYB (^DXY is dead on Yahoo).

import { getYahooQuotes } from "./yahoo"
import type { MarketQuote } from "./freshness"

export interface IndexInstrument {
  symbol: string
  label: string
}

export const INDEX_CATALOG: IndexInstrument[] = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^NDX", label: "Nasdaq 100" },
  { symbol: "^DJI", label: "Dow Jones" },
  { symbol: "^RUT", label: "Russell 2000" },
  { symbol: "^VIX", label: "VIX" },
  { symbol: "^TNX", label: "10Y Yield %" },
  { symbol: "DX-Y.NYB", label: "Dollar Index" },
]

export async function getIndexQuotes(): Promise<MarketQuote[]> {
  return getYahooQuotes(INDEX_CATALOG.map(i => i.symbol), "yahoo.index", 60)
}
