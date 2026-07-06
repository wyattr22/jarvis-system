// Pure options-positioning math, provider-agnostic.
// Both the Alpaca chain (11.4) and the Yahoo fallback normalize into
// OptionContract[] and share these functions. All exported for unit tests.

export interface OptionContract {
  strike: number
  right: "C" | "P"
  openInterest: number
  /** Implied volatility as a decimal (0.3 = 30%); optional per source */
  impliedVolatility?: number
}

export function bsGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T))
  return Math.exp(-d1 * d1 / 2) / (Math.sqrt(2 * Math.PI) * S * sigma * Math.sqrt(T))
}

/** Strike where total option-holder pain (payout) is minimized. */
export function computeMaxPain(contracts: OptionContract[], spot: number): number {
  const strikes = [...new Set(contracts.map(c => c.strike))].sort((a, b) => a - b)
  let minPain = Infinity
  let maxPain = spot
  for (const s of strikes) {
    let pain = 0
    for (const c of contracts) {
      if (c.right === "C" && s > c.strike) pain += (s - c.strike) * c.openInterest
      if (c.right === "P" && s < c.strike) pain += (c.strike - s) * c.openInterest
    }
    if (pain < minPain) {
      minPain = pain
      maxPain = s
    }
  }
  return maxPain
}

/** Put/call open-interest ratio; 1 when there is no call OI. */
export function computePcRatio(contracts: OptionContract[]): number {
  let callOI = 0
  let putOI = 0
  for (const c of contracts) {
    if (c.right === "C") callOI += c.openInterest
    else putOI += c.openInterest
  }
  return callOI > 0 ? putOI / callOI : 1
}

/**
 * Net gamma exposure in dollars: calls positive, puts negative.
 * T defaults to the 30-day proxy the Yahoo path always used.
 */
export function computeGex(
  contracts: OptionContract[],
  spot: number,
  T = 30 / 365,
  r = 0.05,
): number {
  let gex = 0
  for (const c of contracts) {
    const g = bsGamma(spot, c.strike, T, r, c.impliedVolatility ?? 0.3)
    const dollars = g * c.openInterest * 100 * spot * spot
    gex += c.right === "C" ? dollars : -dollars
  }
  return gex
}

/** Top-N strikes by open interest for one side of the book. */
export function topWalls(
  contracts: OptionContract[],
  right: "C" | "P",
  n = 3,
): { strike: number; oi: number }[] {
  return contracts
    .filter(c => c.right === right)
    .sort((a, b) => b.openInterest - a.openInterest)
    .slice(0, n)
    .map(c => ({ strike: c.strike, oi: c.openInterest }))
}
