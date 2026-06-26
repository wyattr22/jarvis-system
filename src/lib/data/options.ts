import { safeFetch } from "@/lib/sandbox/whitelist"

export interface OptionsSnapshot {
  spot: number
  maxPain: number
  pcRatio: number
  gex: number
  callWalls: { strike: number; oi: number }[]
  putWalls: { strike: number; oi: number }[]
}

function bsGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T))
  return Math.exp(-d1 * d1 / 2) / (Math.sqrt(2 * Math.PI) * S * sigma * Math.sqrt(T))
}

export async function getOptionsSnapshot(symbol: string): Promise<OptionsSnapshot | null> {
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

    // P/C ratio
    const callOI = calls.reduce((s, c) => s + (c.openInterest ?? 0), 0)
    const putOI = puts.reduce((s, p) => s + (p.openInterest ?? 0), 0)
    const pcRatio = callOI > 0 ? putOI / callOI : 1

    // Max pain
    const strikes = [...new Set([
      ...calls.map(c => c.strike as number),
      ...puts.map(p => p.strike as number),
    ])].sort((a, b) => a - b)

    let minPain = Infinity, maxPain = spot
    for (const s of strikes) {
      let pain = 0
      for (const c of calls) if (s > c.strike) pain += (s - c.strike) * (c.openInterest ?? 0)
      for (const p of puts) if (s < p.strike) pain += (p.strike - s) * (p.openInterest ?? 0)
      if (pain < minPain) { minPain = pain; maxPain = s }
    }

    // GEX — nearest expiry, T≈30d proxy
    const T = 30 / 365
    let gex = 0
    for (const c of calls) {
      const g = bsGamma(spot, c.strike as number, T, 0.05, (c.impliedVolatility as number) ?? 0.3)
      gex += g * (c.openInterest ?? 0) * 100 * spot * spot
    }
    for (const p of puts) {
      const g = bsGamma(spot, p.strike as number, T, 0.05, (p.impliedVolatility as number) ?? 0.3)
      gex -= g * (p.openInterest ?? 0) * 100 * spot * spot
    }

    const callWalls = [...calls]
      .sort((a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0))
      .slice(0, 3)
      .map(c => ({ strike: c.strike as number, oi: (c.openInterest ?? 0) as number }))

    const putWalls = [...puts]
      .sort((a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0))
      .slice(0, 3)
      .map(p => ({ strike: p.strike as number, oi: (p.openInterest ?? 0) as number }))

    return { spot, maxPain, pcRatio, gex, callWalls, putWalls }
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