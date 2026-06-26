import type { Bar } from "@/lib/data/alpaca"

export interface FVGZone {
  type: "bullish" | "bearish"
  high: number
  low: number
  age: number  // bars since formed
  distancePct: number  // % from current price
}

export interface OrderBlock {
  type: "bullish" | "bearish"
  high: number
  low: number
  age: number
  distancePct: number
}

export interface SwingPoint {
  type: "high" | "low"
  price: number
  age: number
}

export interface SMCAnalysis {
  currentPrice: number
  premarketGap: string
  fvgsAbove: FVGZone[]
  fvgsBelow: FVGZone[]
  bullishOBs: OrderBlock[]    // support — below price
  bearishOBs: OrderBlock[]    // resistance — above price
  swingHighs: SwingPoint[]
  swingLows: SwingPoint[]
  oteZone: { high: number; low: number; direction: "bullish" | "bearish" } | null
  equalHighs: number[]        // buy-side liquidity above
  equalLows: number[]         // sell-side liquidity below
  biasDirection: "bullish" | "bearish" | "neutral"
  summary: string             // natural language description
}

// ── FVG detection ─────────────────────────────────────────────
function findFVGs(bars: Bar[], currentPrice: number): { above: FVGZone[]; below: FVGZone[] } {
  const above: FVGZone[] = []
  const below: FVGZone[] = []
  const n = bars.length

  for (let i = 0; i < n - 2; i++) {
    const age = n - 2 - i
    if (age > 60) continue  // only look back 60 bars

    const bullFvg = bars[i + 2].l > bars[i].h
    const bearFvg = bars[i + 2].h < bars[i].l

    if (bullFvg) {
      const high = bars[i + 2].l
      const low = bars[i].h
      // Check if filled (price traded back into zone after it formed)
      const filled = bars.slice(i + 3).some(b => b.l <= low)
      if (!filled) {
        const zone: FVGZone = {
          type: "bullish",
          high,
          low,
          age,
          distancePct: (low - currentPrice) / currentPrice * 100,
        }
        if (low > currentPrice) above.push(zone)
        else if (high < currentPrice) below.push(zone)
        // If price is inside the FVG, put it in both for context
      }
    }

    if (bearFvg) {
      const low = bars[i + 2].h
      const high = bars[i].l
      const filled = bars.slice(i + 3).some(b => b.h >= high)
      if (!filled) {
        const zone: FVGZone = {
          type: "bearish",
          high,
          low,
          age,
          distancePct: (low - currentPrice) / currentPrice * 100,
        }
        if (low > currentPrice) above.push(zone)
        else if (high < currentPrice) below.push(zone)
      }
    }
  }

  // Sort: above by distance ascending (nearest first), below by distance descending (nearest first)
  above.sort((a, b) => a.low - b.low)
  below.sort((a, b) => b.high - a.high)

  return { above: above.slice(0, 4), below: below.slice(0, 4) }
}

// ── Swing point detection ─────────────────────────────────────
function findSwings(bars: Bar[], currentPrice: number): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = []
  const lows: SwingPoint[] = []
  const n = bars.length
  const LB = 4  // lookback/lookahead on each side

  for (let i = LB; i < n - LB; i++) {
    const age = n - 1 - i
    if (age > 50) continue

    const isHigh = bars.slice(i - LB, i).every(b => b.h <= bars[i].h) &&
                   bars.slice(i + 1, i + LB + 1).every(b => b.h <= bars[i].h)
    const isLow = bars.slice(i - LB, i).every(b => b.l >= bars[i].l) &&
                  bars.slice(i + 1, i + LB + 1).every(b => b.l >= bars[i].l)

    if (isHigh) highs.push({ type: "high", price: bars[i].h, age })
    if (isLow) lows.push({ type: "low", price: bars[i].l, age })
  }

  // Sort by age (most recent first)
  highs.sort((a, b) => a.age - b.age)
  lows.sort((a, b) => a.age - b.age)

  return {
    highs: highs.slice(0, 5),
    lows: lows.slice(0, 5),
  }
}

// ── Order block detection ─────────────────────────────────────
function findOrderBlocks(bars: Bar[], currentPrice: number): { bullish: OrderBlock[]; bearish: OrderBlock[] } {
  const bullish: OrderBlock[] = []
  const bearish: OrderBlock[] = []
  const n = bars.length

  for (let i = 1; i < n - 3; i++) {
    const age = n - 1 - i
    if (age > 40) continue

    const bar = bars[i]
    const nextBar = bars[i + 1]

    // Bullish OB: bearish candle immediately before a strong bullish move
    if (bar.c < bar.o && nextBar.c > nextBar.o) {
      const impulseMagnitude = (nextBar.h - nextBar.l) / bar.h
      if (impulseMagnitude > 0.003) {
        bullish.push({
          type: "bullish",
          high: bar.h,
          low: bar.l,
          age,
          distancePct: (bar.h - currentPrice) / currentPrice * 100,
        })
      }
    }

    // Bearish OB: bullish candle immediately before a strong bearish move
    if (bar.c > bar.o && nextBar.c < nextBar.o) {
      const impulseMagnitude = (nextBar.h - nextBar.l) / bar.l
      if (impulseMagnitude > 0.003) {
        bearish.push({
          type: "bearish",
          high: bar.h,
          low: bar.l,
          age,
          distancePct: (bar.l - currentPrice) / currentPrice * 100,
        })
      }
    }
  }

  // Bullish OBs act as support (below price), bearish OBs as resistance (above price)
  const bullBelow = bullish.filter(ob => ob.high < currentPrice).sort((a, b) => b.high - a.high)
  const bearAbove = bearish.filter(ob => ob.low > currentPrice).sort((a, b) => a.low - b.low)

  return {
    bullish: bullBelow.slice(0, 3),
    bearish: bearAbove.slice(0, 3),
  }
}

// ── Equal highs/lows (liquidity pools) ───────────────────────
function findLiquidity(bars: Bar[], currentPrice: number): { above: number[]; below: number[] } {
  const TOLERANCE = 0.0015  // 0.15%
  const recent = bars.slice(-40)
  const above = new Set<number>()
  const below = new Set<number>()

  for (let i = 0; i < recent.length - 1; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const hiDiff = Math.abs(recent[i].h - recent[j].h) / recent[i].h
      const loDiff = Math.abs(recent[i].l - recent[j].l) / recent[i].l

      if (hiDiff < TOLERANCE) {
        const level = (recent[i].h + recent[j].h) / 2
        if (level > currentPrice * 1.001) above.add(Math.round(level * 100) / 100)
      }
      if (loDiff < TOLERANCE) {
        const level = (recent[i].l + recent[j].l) / 2
        if (level < currentPrice * 0.999) below.add(Math.round(level * 100) / 100)
      }
    }
  }

  const sortedAbove = [...above].sort((a, b) => a - b).slice(0, 3)
  const sortedBelow = [...below].sort((a, b) => b - a).slice(0, 3)
  return { above: sortedAbove, below: sortedBelow }
}

// ── OTE zone (optimal trade entry) ───────────────────────────
function findOTEZone(
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  currentPrice: number
): SMCAnalysis["oteZone"] {
  if (!swingHighs.length || !swingLows.length) return null

  const latestHigh = swingHighs[0]
  const latestLow = swingLows[0]

  // Determine last move direction
  if (latestHigh.age < latestLow.age) {
    // Last swing was a high → likely in a distribution / bearish retracement
    // OTE for shorts: 61.8–78.6% of the downmove from some prior low to this high
    // For now: just compute retracement back up from the nearest low before this high
    const priorLow = swingLows.find(s => s.age > latestHigh.age)
    if (!priorLow) return null
    const range = latestHigh.price - priorLow.price
    if (range <= 0) return null
    return {
      direction: "bearish",
      high: latestHigh.price - range * 0.618,
      low: latestHigh.price - range * 0.786,
    }
  } else {
    // Last swing was a low → likely in an accumulation / bullish retracement
    const priorHigh = swingHighs.find(s => s.age > latestLow.age)
    if (!priorHigh) return null
    const range = priorHigh.price - latestLow.price
    if (range <= 0) return null
    return {
      direction: "bullish",
      high: latestLow.price + range * 0.382,  // entry at 38.2%–0% retracement of prior move
      low: latestLow.price + range * 0.236,
    }
  }
}

// ── Pre-market gap ────────────────────────────────────────────
function detectPremarketGap(bars: Bar[]): string {
  // Find the boundary between yesterday's session and today's session
  // Market sessions are roughly 13:30–20:00 UTC (9:30 AM–4:00 PM ET)
  let sessionBreakIdx = -1

  for (let i = bars.length - 1; i > 0; i--) {
    const curr = new Date(bars[i].t)
    const prev = new Date(bars[i - 1].t)
    // Gap of more than 4 hours between bars = session boundary
    if (curr.getTime() - prev.getTime() > 4 * 60 * 60 * 1000) {
      sessionBreakIdx = i
      break
    }
  }

  if (sessionBreakIdx <= 0) return ""

  const prevClose = bars[sessionBreakIdx - 1].c
  const todayOpen = bars[sessionBreakIdx].o
  const gapPct = (todayOpen - prevClose) / prevClose * 100

  if (Math.abs(gapPct) < 0.1) return ""

  const dir = gapPct > 0 ? "gap UP" : "gap DOWN"
  const fvgNote = Math.abs(gapPct) > 0.4
    ? ` — gap zone (${Math.min(prevClose, todayOpen).toFixed(2)}–${Math.max(prevClose, todayOpen).toFixed(2)}) is an unfilled imbalance`
    : ""

  return `${dir} ${gapPct > 0 ? "+" : ""}${gapPct.toFixed(2)}% at open (prev close ${prevClose.toFixed(2)} → open ${todayOpen.toFixed(2)})${fvgNote}`
}

// ── Bias ──────────────────────────────────────────────────────
function getBias(swingHighs: SwingPoint[], swingLows: SwingPoint[], bars: Bar[]): "bullish" | "bearish" | "neutral" {
  // Higher highs + higher lows = bullish, lower highs + lower lows = bearish
  if (swingHighs.length < 2 || swingLows.length < 2) return "neutral"

  const hhCheck = swingHighs[0].price > swingHighs[1].price
  const hlCheck = swingLows[0].price > swingLows[1].price
  const lhCheck = swingHighs[0].price < swingHighs[1].price
  const llCheck = swingLows[0].price < swingLows[1].price

  if (hhCheck && hlCheck) return "bullish"
  if (lhCheck && llCheck) return "bearish"

  // Fallback: EMA cross from features
  const closes = bars.map(b => b.c)
  const ema9 = closes.slice(-9).reduce((p, c, i, a) => i === 0 ? c : c * (2 / 10) + p * (8 / 10))
  const ema21 = closes.slice(-21).reduce((p, c, i, a) => i === 0 ? c : c * (2 / 22) + p * (20 / 22))
  return ema9 > ema21 ? "bullish" : ema9 < ema21 ? "bearish" : "neutral"
}

// ── Main export ───────────────────────────────────────────────
export function analyzeSMC(bars: Bar[], symbol: string): SMCAnalysis {
  const currentPrice = bars[bars.length - 1].c

  const { above: fvgsAbove, below: fvgsBelow } = findFVGs(bars, currentPrice)
  const { highs: swingHighs, lows: swingLows } = findSwings(bars, currentPrice)
  const { bullish: bullishOBs, bearish: bearishOBs } = findOrderBlocks(bars, currentPrice)
  const { above: equalHighs, below: equalLows } = findLiquidity(bars, currentPrice)
  const oteZone = findOTEZone(swingHighs, swingLows, currentPrice)
  const biasDirection = getBias(swingHighs, swingLows, bars)
  const premarketGap = detectPremarketGap(bars)

  // ── Natural language summary ──────────────────────────────
  const lines: string[] = []

  lines.push(`BIAS: ${biasDirection.toUpperCase()}`)

  if (premarketGap) lines.push(`PRE-MARKET: ${premarketGap}`)

  if (fvgsAbove.length) {
    const fvg = fvgsAbove[0]
    lines.push(`NEAREST FVG ABOVE: ${fvg.low.toFixed(2)}–${fvg.high.toFixed(2)} (${fvg.type}, ${fvg.age} bars ago, +${((fvg.low - currentPrice) / currentPrice * 100).toFixed(2)}% away)`)
  }
  if (fvgsBelow.length) {
    const fvg = fvgsBelow[0]
    lines.push(`NEAREST FVG BELOW: ${fvg.low.toFixed(2)}–${fvg.high.toFixed(2)} (${fvg.type}, ${fvg.age} bars ago, ${((fvg.high - currentPrice) / currentPrice * 100).toFixed(2)}% away)`)
  }
  if (fvgsAbove.length > 1) {
    lines.push(`ADDITIONAL FVGs ABOVE: ${fvgsAbove.slice(1).map(f => `${f.low.toFixed(2)}–${f.high.toFixed(2)}`).join(', ')}`)
  }
  if (fvgsBelow.length > 1) {
    lines.push(`ADDITIONAL FVGs BELOW: ${fvgsBelow.slice(1).map(f => `${f.low.toFixed(2)}–${f.high.toFixed(2)}`).join(', ')}`)
  }

  if (bearishOBs.length) {
    const ob = bearishOBs[0]
    lines.push(`BEARISH OB RESISTANCE: ${ob.low.toFixed(2)}–${ob.high.toFixed(2)} (${ob.age} bars ago)`)
  }
  if (bullishOBs.length) {
    const ob = bullishOBs[0]
    lines.push(`BULLISH OB SUPPORT: ${ob.low.toFixed(2)}–${ob.high.toFixed(2)} (${ob.age} bars ago)`)
  }

  if (oteZone) {
    lines.push(`OTE ZONE (${oteZone.direction} entry): ${oteZone.low.toFixed(2)}–${oteZone.high.toFixed(2)}`)
  }

  if (swingHighs.length) {
    lines.push(`RECENT SWING HIGHS: ${swingHighs.slice(0, 3).map(s => `${s.price.toFixed(2)} (${s.age}b ago)`).join(', ')}`)
  }
  if (swingLows.length) {
    lines.push(`RECENT SWING LOWS: ${swingLows.slice(0, 3).map(s => `${s.price.toFixed(2)} (${s.age}b ago)`).join(', ')}`)
  }

  if (equalHighs.length) lines.push(`BUY-SIDE LIQUIDITY (equal highs): ${equalHighs.join(', ')}`)
  if (equalLows.length) lines.push(`SELL-SIDE LIQUIDITY (equal lows): ${equalLows.join(', ')}`)

  return {
    currentPrice,
    premarketGap,
    fvgsAbove,
    fvgsBelow,
    bullishOBs,
    bearishOBs,
    swingHighs,
    swingLows,
    oteZone,
    equalHighs,
    equalLows,
    biasDirection,
    summary: lines.join('\n'),
  }
}
