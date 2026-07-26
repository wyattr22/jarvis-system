// Indicator + SMC-detector primitives (Phase 16).
//
// Extracted byte-for-byte from src/lib/backtest/bot-strategy.ts's private
// functions — same formulas, same magic constants — so both the legacy
// hardcoded smc-ict-v4 algorithm AND the new rule-engine interpreter call
// the exact same math. bot-strategy.ts now imports from here instead of
// defining these locally; nothing about its behavior changes.

export interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }

export const FVG_MIN_SIZE_PCT = 0.001
export const SWING_LOOKBACK   = 8
export const FIBO_OTE_LOW     = 0.62
export const FIBO_OTE_HIGH    = 0.79
export const FIBO_TOLERANCE   = 0.035
export const MAX_CANDLE_MULT  = 4.0

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 2) return 50
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gains += d; else losses += -d
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

export function calcEMA(closes: number[], period: number): number[] {
  if (!closes.length) return []
  const k = 2 / (period + 1)
  const out = [closes[0]]
  for (let i = 1; i < closes.length; i++) out.push(closes[i] * k + out[i - 1] * (1 - k))
  return out
}

export function calcVolMA(volumes: number[], period = 20): number[] {
  return volumes.map((_, i) => {
    if (i < period - 1) return NaN
    return volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  })
}

export function calcATR(bars: Bar[], period = 14): number[] {
  if (bars.length < 2) return [NaN]
  const trs = bars.slice(1).map((b, i) =>
    Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c))
  )
  const atrs: number[] = Array(period).fill(NaN)
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  atrs.push(atr)
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period
    atrs.push(atr)
  }
  return atrs
}

export function calcBodyAvg(bars: Bar[], period = 20): number[] {
  const bodies = bars.map(b => Math.abs(b.c - b.o))
  return bodies.map((_, i) => {
    if (i < period - 1) return NaN
    return bodies.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  })
}

export function findFVG(window: Bar[], direction: 'bullish' | 'bearish') {
  const fvgs: Array<{ top: number; bottom: number; mid: number; index: number }> = []
  for (let i = 1; i < window.length - 1; i++) {
    const top = direction === 'bullish' ? window[i - 1].l : window[i + 1].l
    const bot = direction === 'bullish' ? window[i + 1].h : window[i - 1].h
    if (top > bot && (top - bot) / bot >= FVG_MIN_SIZE_PCT)
      fvgs.push({ top, bottom: bot, mid: (top + bot) / 2, index: i })
  }
  return fvgs
}

export function findIFVG(window: Bar[], price: number, direction: 'bullish' | 'bearish'): boolean {
  const opp = direction === 'bullish' ? 'bearish' : 'bullish'
  for (const fvg of findFVG(window, opp)) {
    if (fvg.index >= window.length - 2) continue
    const future = window.slice(fvg.index + 1)
    if (direction === 'bullish') {
      if (future.some(b => b.l <= fvg.top) && fvg.bottom <= price && price <= fvg.top * 1.005) return true
    } else {
      if (future.some(b => b.h >= fvg.bottom) && fvg.bottom * 0.995 <= price && price <= fvg.top) return true
    }
  }
  return false
}

export function findOrderBlock(window: Bar[], direction: 'bullish' | 'bearish') {
  const obs: Array<{ top: number; bottom: number; index: number }> = []
  for (let i = 2; i < window.length - 3; i++) {
    const candle = window[i]
    const last20 = window.slice(Math.max(0, i - 20), i)
    if (!last20.length) continue
    const avgRange = last20.reduce((s, b) => s + (b.h - b.l), 0) / last20.length
    if (avgRange === 0) continue
    const next3 = window.slice(i + 1, i + 4)
    if (!next3.length) continue
    if (direction === 'bullish' && candle.c < candle.o) {
      if (Math.max(...next3.map(b => b.c)) - candle.c > avgRange * 1.5)
        obs.push({ top: candle.h, bottom: candle.l, index: i })
    } else if (direction === 'bearish' && candle.c > candle.o) {
      if (candle.c - Math.min(...next3.map(b => b.c)) > avgRange * 1.5)
        obs.push({ top: candle.h, bottom: candle.l, index: i })
    }
  }
  return obs
}

export function findBreaker(window: Bar[], price: number, direction: 'bullish' | 'bearish'): boolean {
  const opp = direction === 'bullish' ? 'bearish' : 'bullish'
  for (const ob of findOrderBlock(window, opp)) {
    if (ob.index >= window.length - 2) continue
    const future = window.slice(ob.index + 1)
    if (direction === 'bullish') {
      if (future.some(b => b.h > ob.top) && ob.bottom <= price && price <= ob.top * 1.01) return true
    } else {
      if (future.some(b => b.l < ob.bottom) && ob.bottom * 0.99 <= price && price <= ob.top) return true
    }
  }
  return false
}

export function detectBOS(window: Bar[], price: number, direction: 'bullish' | 'bearish'): boolean {
  const recent = window.slice(-22, -1)
  if (recent.length < 10) return false
  if (direction === 'bullish') {
    let swingHigh = -Infinity
    for (let i = 2; i < recent.length - 2; i++) {
      const max = Math.max(...recent.slice(i - 2, i + 3).map(b => b.h))
      if (recent[i].h === max) swingHigh = Math.max(swingHigh, recent[i].h)
    }
    return swingHigh > -Infinity && price > swingHigh * 1.001
  } else {
    let swingLow = Infinity
    for (let i = 2; i < recent.length - 2; i++) {
      const min = Math.min(...recent.slice(i - 2, i + 3).map(b => b.l))
      if (recent[i].l === min) swingLow = Math.min(swingLow, recent[i].l)
    }
    return swingLow < Infinity && price < swingLow * 0.999
  }
}

export function checkOTE(swLow: number, swHigh: number, price: number, direction: 'bullish' | 'bearish'): boolean {
  if (swHigh <= swLow) return false
  const rng = swHigh - swLow
  const oteLo = direction === 'bullish'
    ? swLow  + FIBO_OTE_LOW  * rng
    : swHigh - FIBO_OTE_HIGH * rng
  const oteHi = direction === 'bullish'
    ? swLow  + FIBO_OTE_HIGH * rng
    : swHigh - FIBO_OTE_LOW  * rng
  return oteLo * (1 - FIBO_TOLERANCE) <= price && price <= oteHi * (1 + FIBO_TOLERANCE)
}

export function checkEquilibrium(rh: number, rl: number, price: number, tol = 0.006): boolean {
  const eq = (rh + rl) / 2
  return Math.abs(price - eq) / eq <= tol
}

export function getStructureStop(window: Bar[], entry: number, bias: 'bullish' | 'bearish'): number {
  const opp = bias === 'bullish' ? 'bearish' : 'bullish'
  const obs = findOrderBlock(window, opp)
  if (bias === 'bullish') {
    const valid = obs.filter(ob => ob.bottom < entry)
    if (valid.length) return valid.reduce((a, b) => b.bottom > a.bottom ? b : a).bottom * 0.998
    return Math.min(...window.slice(-7, -1).map(b => b.l)) * 0.998
  } else {
    const valid = obs.filter(ob => ob.top > entry)
    if (valid.length) return valid.reduce((a, b) => b.top < a.top ? b : a).top * 1.002
    return Math.max(...window.slice(-7, -1).map(b => b.h)) * 1.002
  }
}

export function getDailyBias(
  dailyBars: Bar[],
  price: number,
  barTimeStr: string
): { bias: 'bullish' | 'bearish'; dol: number; rh: number; rl: number } | null {
  const barDate = barTimeStr.slice(0, 10)
  const prior = dailyBars.filter(b => b.t.slice(0, 10) < barDate)
  if (prior.length < 3) return null

  const prev = prior[prior.length - 1]
  const rh = prev.h, rl = prev.l
  const prevMid = (rh + rl) / 2
  if (Math.abs(price - prevMid) / prevMid < 0.001) return null

  const recent = prior.slice(-30)
  const n = SWING_LOOKBACK
  const swingHighs: number[] = [], swingLows: number[] = []
  for (let i = n; i < recent.length - n; i++) {
    const hiWin = recent.slice(i - n, i + n + 1).map(b => b.h)
    if (recent[i].h === Math.max(...hiWin)) swingHighs.push(recent[i].h)
    const loWin = recent.slice(i - n, i + n + 1).map(b => b.l)
    if (recent[i].l === Math.min(...loWin)) swingLows.push(recent[i].l)
  }

  const dolH = swingHighs.length >= 3 ? Math.max(...swingHighs.slice(-3)) : rh * 1.02
  const dolL = swingLows.length >= 3  ? Math.min(...swingLows.slice(-3))  : rl * 0.98

  return price > prevMid
    ? { bias: 'bullish', dol: dolH, rh, rl }
    : { bias: 'bearish', dol: dolL, rh, rl }
}

export function checkLiquidityRaid(
  bars: Bar[], i: number,
  bias: 'bullish' | 'bearish',
  rh: number, rl: number
): boolean {
  if (i < 7) return false
  const recent = bars.slice(i - 6, i)
  const cur = bars[i]
  const levels = bias === 'bullish' ? [rl, (rh + rl) / 2] : [rh, (rh + rl) / 2]
  for (const level of levels) {
    if (bias === 'bullish') {
      if (recent.some(b => b.l < level) && cur.c > level && cur.c > cur.o) return true
    } else {
      if (recent.some(b => b.h > level) && cur.c < level && cur.c < cur.o) return true
    }
  }
  return false
}

export function getSpyTrend(
  spyBars: Bar[],
  barTimeStr: string
): 'bullish' | 'bearish' | 'neutral' {
  const barDate = barTimeStr.slice(0, 10)
  const dayBars = spyBars.filter(b => b.t.startsWith(barDate))
  if (!dayBars.length) return 'neutral'
  const openPrice = dayBars[0].o
  const past = spyBars.filter(b => b.t <= barTimeStr)
  if (!past.length) return 'neutral'
  const movePct = (past[past.length - 1].c - openPrice) / openPrice
  if (movePct > 0.01) return 'bullish'
  if (movePct < -0.01) return 'bearish'
  return 'neutral'
}
