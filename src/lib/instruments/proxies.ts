// Futures visibility honesty pairing (Phase 11 decision):
// no legal free real-time CME data exists (real-time needs ~$25/mo API +
// $290-500/mo CME license — rejected under the free-tier philosophy), so
// every delayed Yahoo continuous contract is paired with a real-time ETF
// proxy quoted from Alpaca IEX. The UI renders both side by side.

export interface FuturesInstrument {
  /** Yahoo continuous-contract symbol */
  future: string
  /** Human name */
  label: string
  /** Real-time ETF proxy (Alpaca IEX) — null where no liquid proxy exists */
  proxy: string | null
  /** CME/CBOT/NYMEX/COMEX root, for 11.6's instrument catalog */
  root: string
  /** Contract multiplier ($ per point) */
  multiplier: number
}

export const FUTURES_CATALOG: FuturesInstrument[] = [
  { future: "ES=F", label: "S&P 500 E-mini", proxy: "SPY", root: "ES", multiplier: 50 },
  { future: "NQ=F", label: "Nasdaq 100 E-mini", proxy: "QQQ", root: "NQ", multiplier: 20 },
  { future: "YM=F", label: "Dow E-mini", proxy: "DIA", root: "YM", multiplier: 5 },
  { future: "RTY=F", label: "Russell 2000 E-mini", proxy: "IWM", root: "RTY", multiplier: 50 },
  { future: "GC=F", label: "Gold", proxy: "GLD", root: "GC", multiplier: 100 },
  { future: "SI=F", label: "Silver", proxy: "SLV", root: "SI", multiplier: 5000 },
  { future: "CL=F", label: "Crude Oil WTI", proxy: "USO", root: "CL", multiplier: 1000 },
  { future: "NG=F", label: "Natural Gas", proxy: "UNG", root: "NG", multiplier: 10000 },
  { future: "ZN=F", label: "10Y T-Note", proxy: "IEF", root: "ZN", multiplier: 1000 },
  { future: "ZB=F", label: "30Y T-Bond", proxy: "TLT", root: "ZB", multiplier: 1000 },
  { future: "6E=F", label: "Euro FX", proxy: "FXE", root: "6E", multiplier: 125000 },
]

export function proxyFor(future: string): string | null {
  return FUTURES_CATALOG.find(f => f.future === future)?.proxy ?? null
}
