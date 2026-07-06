// Options positioning snapshot — provider dispatch:
//   1. Alpaca (free tier: contracts endpoint for OI + indicative snapshots
//      for quotes/IV, 15-min delayed) — primary since 11.4
//   2. Yahoo options scrape — fallback (brittle unofficial API)
// Both normalize into OptionContract[] and share the pure math in
// options-math.ts. The snapshot carries QuoteMeta so the UI can badge it.

import { safeFetch } from "@/lib/sandbox/whitelist"
import { metaFor, type QuoteMeta } from "./freshness"
import { getLatestQuote } from "./alpaca"
import { getAlpacaChain } from "./alpaca-options"
import {
  computeMaxPain,
  computePcRatio,
  computeGex,
  topWalls,
  type OptionContract,
} from "./options-math"

export interface OptionsSnapshot {
  spot: number
  maxPain: number
  pcRatio: number
  gex: number
  callWalls: { strike: number; oi: number }[]
  putWalls: { strike: number; oi: number }[]
  meta: QuoteMeta
}

// Exported for tests — pure assembly from a normalized chain.
export function buildSnapshot(
  contracts: OptionContract[],
  spot: number,
  meta: QuoteMeta,
): OptionsSnapshot {
  return {
    spot,
    maxPain: computeMaxPain(contracts, spot),
    pcRatio: computePcRatio(contracts),
    gex: computeGex(contracts, spot),
    callWalls: topWalls(contracts, "C"),
    putWalls: topWalls(contracts, "P"),
    meta,
  }
}

export async function getOptionsSnapshot(symbol: string): Promise<OptionsSnapshot | null> {
  // Primary: Alpaca free tier (real OI, official OPRA-derived quotes, 15-min delayed)
  try {
    const quote = await getLatestQuote(symbol)
    const spot = quote.mid
    if (spot > 0) {
      const chain = await getAlpacaChain(symbol, spot)
      if (chain) {
        return buildSnapshot(chain.contracts, spot, metaFor("alpaca.options", chain.asOf))
      }
    }
  } catch {
    // fall through to Yahoo
  }
  return getYahooOptionsSnapshot(symbol)
}

// Legacy Yahoo scrape, kept as the fallback path.
async function getYahooOptionsSnapshot(symbol: string): Promise<OptionsSnapshot | null> {
  try {
    const res = await safeFetch(
      `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Jarvis/2.0)' },
        signal: AbortSignal.timeout(8000),
        next: { revalidate: 300 },
      }
    )
    if (!res.ok) return null
    const json = await res.json()
    const result = json.optionChain?.result?.[0]
    if (!result) return null

    const spot: number = result.quote?.regularMarketPrice ?? 0
    const calls: Record<string, number>[] = result.options?.[0]?.calls ?? []
    const puts: Record<string, number>[] = result.options?.[0]?.puts ?? []
    if (!spot || !calls.length) return null

    const contracts: OptionContract[] = [
      ...calls.map(c => ({
        strike: c.strike as number,
        right: "C" as const,
        openInterest: (c.openInterest ?? 0) as number,
        impliedVolatility: c.impliedVolatility as number | undefined,
      })),
      ...puts.map(p => ({
        strike: p.strike as number,
        right: "P" as const,
        openInterest: (p.openInterest ?? 0) as number,
        impliedVolatility: p.impliedVolatility as number | undefined,
      })),
    ]

    return buildSnapshot(contracts, spot, metaFor("yahoo.options", new Date().toISOString()))
  } catch {
    return null
  }
}

export function formatOptionsForContext(symbol: string, snap: OptionsSnapshot): string {
  const gexDir = snap.gex > 0 ? 'long gamma (pinning)' : 'short gamma (trending)'
  const pcSent = snap.pcRatio > 1.2 ? 'bearish' : snap.pcRatio < 0.8 ? 'bullish' : 'neutral'
  const callStr = snap.callWalls.map(c => `$${c.strike}(${(c.oi / 1000).toFixed(0)}k OI)`).join(', ')
  const putStr = snap.putWalls.map(p => `$${p.strike}(${(p.oi / 1000).toFixed(0)}k OI)`).join(', ')
  const gexB = (snap.gex / 1e9).toFixed(2)
  return `${symbol} OPTIONS: max_pain=$${snap.maxPain}, P/C=${snap.pcRatio.toFixed(2)} (${pcSent}), GEX=$${gexB}B ${gexDir}\n  call walls: ${callStr}\n  put walls: ${putStr}`
}
