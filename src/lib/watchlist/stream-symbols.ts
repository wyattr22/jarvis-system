// Pure selection logic for the SSE quote stream (11.8): watchlist equities
// first (the stream is Alpaca-backed, so non-equity instruments are skipped),
// deduped, topped up with the legacy defaults, capped.

import { parseInstrument } from "@/lib/instruments/parse"

export const DEFAULT_STREAM_SYMBOLS = [
  "TSLA", "RIOT", "MARA", "HUT", "IONQ", "HOOD", "SNAP", "NVDA", "AAPL", "SPY", "QQQ", "ALAB",
]

export function pickStreamSymbols(
  watchlist: string[],
  defaults: string[] = DEFAULT_STREAM_SYMBOLS,
  cap = 25,
): string[] {
  const equities = watchlist
    .map(s => parseInstrument(s))
    .filter(p => p.assetClass === "equity" || p.assetClass === "crypto")
    .map(p => p.underlying)
  const out: string[] = []
  for (const s of [...equities, ...defaults]) {
    if (!out.includes(s)) out.push(s)
    if (out.length >= cap) break
  }
  return out
}
