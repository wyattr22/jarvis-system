// Map internal symbols (Yahoo/Alpaca conventions) to TradingView widget
// symbols so any markets tile can open a TradingView chart (12.1).

const INDEX_MAP: Record<string, string> = {
  "^GSPC": "SP:SPX",
  "^NDX": "NASDAQ:NDX",
  "^DJI": "DJ:DJI",
  "^RUT": "TVC:RUT",
  "^VIX": "TVC:VIX",
  "^TNX": "TVC:TNX",
  "DX-Y.NYB": "TVC:DXY",
}

// Continuous front-month contracts on TradingView use the `1!` suffix.
const FUTURES_MAP: Record<string, string> = {
  "ES=F": "CME_MINI:ES1!",
  "NQ=F": "CME_MINI:NQ1!",
  "YM=F": "CBOT_MINI:YM1!",
  "RTY=F": "CME_MINI:RTY1!",
  "GC=F": "COMEX:GC1!",
  "SI=F": "COMEX:SI1!",
  "CL=F": "NYMEX:CL1!",
  "NG=F": "NYMEX:NG1!",
  "ZN=F": "CBOT:ZN1!",
  "ZB=F": "CBOT:ZB1!",
  "6E=F": "CME:6E1!",
}

/**
 * Internal symbol -> TradingView symbol.
 *   "^GSPC" -> "SP:SPX"      "ES=F" -> "CME_MINI:ES1!"
 *   "EURUSD=X" / "EUR/USD" -> "FX:EURUSD"      "AAPL" -> "AAPL"
 */
export function toTradingViewSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase()
  if (INDEX_MAP[s]) return INDEX_MAP[s]
  if (FUTURES_MAP[s]) return FUTURES_MAP[s]
  if (s.endsWith("=X")) return `FX:${s.slice(0, -2)}`
  if (s.includes("/") && s.length === 7) return `FX:${s.replace("/", "")}`
  return s // plain equity/ETF — TradingView resolves the bare ticker
}
