/**
 * TypeScript port of bot.py's SMC/ICT signal detection logic.
 * Parameters and confluence rules are exact matches — same UNIVERSE, same gates.
 *
 * Phase 16: the indicator/detector math below was extracted verbatim into
 * src/lib/strategy-engine/indicators.ts so the new rule-engine interpreter
 * can call the exact same functions. This file re-imports them instead of
 * defining them locally — checkBotSignal's behavior is unchanged.
 */

import {
  type Bar as EngineBar,
  calcRSI, calcEMA, calcVolMA, calcATR, calcBodyAvg,
  findFVG, findIFVG, findOrderBlock, findBreaker, detectBOS, checkOTE, checkEquilibrium,
  getStructureStop, getDailyBias, checkLiquidityRaid, getSpyTrend,
} from "@/lib/strategy-engine/indicators"

// Re-exported for backward compat — nothing outside this file currently
// imports it from here, but it was public API before Phase 16's extraction.
export { getSpyTrend } from "@/lib/strategy-engine/indicators"

// ── Parameters (synced with bot.py) ──────────────────────────
export const UNIVERSE = [
  'RIOT','MARA','HUT','RCAT','IONQ','TSLA',
  'UVXY','HOOD','SNAP','ALAB','AAOI','CRDO',
]

export const TAKE_PROFIT_PCT   = 0.04
export const MAX_STOP_RISK_PCT = 0.03
export const MIN_RR_RATIO      = 2.0
export const MIN_ENTRY_PRICE   = 2.0
export const RSI_MIN           = 40
export const RSI_MAX           = 80
export const VOLUME_MULTIPLIER = 1.0
export const EMA_FAST          = 9
export const EMA_SLOW          = 21
export const ATR_PERIOD        = 14
export const ATR_MIN_PCT       = 0.004
export const MAX_CANDLE_MULT   = 4.0
export const FVG_MIN_SIZE_PCT  = 0.001
export const SWING_LOOKBACK    = 8
export const FIBO_OTE_LOW      = 0.62
export const FIBO_OTE_HIGH     = 0.79
export const FIBO_TOLERANCE    = 0.035

// ── Tunable strategy parameters (12.6) ───────────────────────
// checkBotSignal defaults to DEFAULT_PARAMS (identical to the consts above,
// i.e. exact bot.py behavior); the adjustable backtester passes overrides.
export interface StrategyParams {
  takeProfitPct: number
  maxStopRiskPct: number
  minRR: number
  minEntryPrice: number
  rsiMin: number
  rsiMax: number
  volumeMultiplier: number
  emaFast: number
  emaSlow: number
  atrMinPct: number
  requireSpyAlignment: boolean
  minReversalConfluences: number     // of IFVG/BOS/OTE (bot.py: 2)
  minContinuationConfluences: number // of FVG/EQ/OB/Breaker (bot.py: 1)
}

export const DEFAULT_PARAMS: StrategyParams = {
  takeProfitPct: TAKE_PROFIT_PCT,
  maxStopRiskPct: MAX_STOP_RISK_PCT,
  minRR: MIN_RR_RATIO,
  minEntryPrice: MIN_ENTRY_PRICE,
  rsiMin: RSI_MIN,
  rsiMax: RSI_MAX,
  volumeMultiplier: VOLUME_MULTIPLIER,
  emaFast: EMA_FAST,
  emaSlow: EMA_SLOW,
  atrMinPct: ATR_MIN_PCT,
  requireSpyAlignment: true,
  minReversalConfluences: 2,
  minContinuationConfluences: 1,
}

export type Bar = EngineBar

export interface BotSignal {
  symbol: string
  bias:     'bullish' | 'bearish'
  price:    number
  rsi:      number
  sl:       number
  tp:       number
  rr:       number
  dol:      number
  slDist:   number
  revTags:  string[]
  contTags: string[]
}

// ── Main signal check ─────────────────────────────────────────

export function checkBotSignal(
  bars15m: Bar[],
  dailyBars: Bar[],
  spyBars: Bar[],
  i: number,
  symbol: string,
  p: StrategyParams = DEFAULT_PARAMS
): BotSignal | null {
  if (i < 35) return null
  const bar = bars15m[i]
  const price = bar.c
  if (price < p.minEntryPrice) return null

  const slicedBars = bars15m.slice(0, i + 1)
  const closes  = slicedBars.map(b => b.c)
  const volumes = slicedBars.map(b => b.v)

  const rsi = calcRSI(closes)
  if (rsi < p.rsiMin || rsi > p.rsiMax) return null

  const emaFast = calcEMA(closes, p.emaFast).slice(-1)[0]
  const emaSlow = calcEMA(closes, p.emaSlow).slice(-1)[0]
  if (isNaN(emaFast) || isNaN(emaSlow)) return null

  const volMA = calcVolMA(volumes).slice(-1)[0]
  if (isNaN(volMA) || bar.v < volMA * p.volumeMultiplier) return null

  const atr = calcATR(slicedBars).slice(-1)[0]
  if (isNaN(atr) || atr / price < p.atrMinPct) return null

  const bodyAvg = calcBodyAvg(slicedBars).slice(-1)[0]
  const body = Math.abs(bar.c - bar.o)
  if (!isNaN(bodyAvg) && bodyAvg > 0 && body > bodyAvg * MAX_CANDLE_MULT) return null

  const biasData = getDailyBias(dailyBars, price, bar.t)
  if (!biasData) return null
  const { bias, dol, rh, rl } = biasData

  const spyTrend = getSpyTrend(spyBars, bar.t)
  if (p.requireSpyAlignment && spyTrend !== 'neutral' && spyTrend !== bias) return null

  // 15m candle confirmation (previous bar closes in bias direction)
  if (i > 0) {
    const prev = bars15m[i - 1]
    const confirmed = bias === 'bullish' ? prev.c > prev.o : prev.c < prev.o
    if (!confirmed) return null
  }

  if (!checkLiquidityRaid(bars15m, i, bias, rh, rl)) return null

  const window = bars15m.slice(Math.max(0, i - 30), i + 1)
  const swLow  = Math.min(...window.map(b => b.l))
  const swHigh = Math.max(...window.map(b => b.h))

  // Reversal confluences — need 2 of 3: IFVG + BOS + OTE
  const ifvgOk = findIFVG(window, price, bias)
  const bosOk  = detectBOS(window, price, bias)
  const oteOk  = checkOTE(swLow, swHigh, price, bias)
  if ([ifvgOk, bosOk, oteOk].filter(Boolean).length < p.minReversalConfluences) return null

  const revTags: string[] = []
  if (ifvgOk) revTags.push('IFVG')
  if (bosOk)  revTags.push('BOS')
  if (oteOk)  revTags.push('OTE')

  // Continuation confluences — need 1 of 4: FVG + EQ + OB + Breaker
  const fvgOk     = findFVG(window, bias).length > 0
  const eqOk      = checkEquilibrium(rh, rl, price)
  const obOk      = findOrderBlock(window, bias).length > 0
  const breakerOk = findBreaker(window, price, bias)
  if ([fvgOk, eqOk, obOk, breakerOk].filter(Boolean).length < p.minContinuationConfluences) return null

  const contTags: string[] = []
  if (fvgOk)     contTags.push('FVG')
  if (eqOk)      contTags.push('EQ')
  if (obOk)      contTags.push('OB')
  if (breakerOk) contTags.push('BREAKER')

  // EMA breakout gate
  const trendOk = bias === 'bullish'
    ? price > emaFast && emaFast > emaSlow
    : price < emaFast && emaFast < emaSlow
  if (!trendOk) return null

  // Structure-based stop (bot.py: nearest opposite order block)
  const sl = getStructureStop(window, price, bias)
  const slDist = Math.abs(price - sl)
  if (slDist / price > p.maxStopRiskPct) return null

  // TP: use DOL if far enough, else fixed pct
  const tp = bias === 'bullish'
    ? (dol > price * (1 + p.takeProfitPct * 0.5) ? dol : price * (1 + p.takeProfitPct))
    : (dol < price * (1 - p.takeProfitPct * 0.5) ? dol : price * (1 - p.takeProfitPct))

  const tpDist = Math.abs(tp - price)
  if (slDist <= 0 || tpDist / slDist < p.minRR) return null

  return {
    symbol, bias, price,
    rsi: Math.round(rsi * 10) / 10,
    sl:  Math.round(sl * 10000) / 10000,
    tp:  Math.round(tp * 10000) / 10000,
    rr:  Math.round((tpDist / slDist) * 100) / 100,
    dol: Math.round(dol * 10000) / 10000,
    slDist, revTags, contTags,
  }
}
