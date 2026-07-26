// Rule-engine interpreter (Phase 16) — evaluates a StrategyDefinition
// against real bar data and returns the same BotSignal shape
// checkBotSignal() returns today, so downstream code (backtest, signal
// engine) can treat an interpreted strategy as a drop-in replacement.
//
// Scoping note on revTags/contTags: these are presentational confluence
// labels, not decision-relevant outputs (bias/price/sl/tp/rr/rr are what
// actually drive P&L and order placement). This interpreter reproduces them
// generically by collecting which boolean ("true_when") conditions fired
// inside entry.condition (→ revTags) and inside entry.filters (→ contTags)
// — for legacy-definition.ts specifically, that structure exactly
// reproduces bot-strategy.ts's reversal/continuation tag split. A strategy
// authored with a different shape gets a best-effort label set instead of
// bit-identical legacy tag grouping, which is fine: nothing downstream
// makes trading decisions off tag *labels*.

import {
  type Bar, calcRSI, calcEMA, calcVolMA, calcATR, calcBodyAvg,
  findFVG, findIFVG, findOrderBlock, findBreaker, detectBOS, checkOTE, checkEquilibrium,
  getStructureStop, getDailyBias, checkLiquidityRaid, getSpyTrend,
} from "./indicators"
import type { Condition, IndicatorRef, StrategyDefinition } from "./schema"

export interface InterpretedSignal {
  symbol: string
  bias: "bullish" | "bearish"
  price: number
  rsi: number
  sl: number
  tp: number
  rr: number
  dol: number
  slDist: number
  revTags: string[]
  contTags: string[]
}

export interface EvalContext {
  bars15m: Bar[]
  dailyBars: Bar[]
  spyBars: Bar[]
  i: number
  symbol: string
}

const TAG_LABELS: Record<string, string> = {
  ifvg: "IFVG", bos: "BOS", ote: "OTE",
  fvg: "FVG", equilibrium: "EQ", order_block: "OB", breaker: "BREAKER",
  liquidity_raid: "LIQUIDITY_RAID", prev_candle_confirms: "CANDLE_CONFIRM",
  spy_alignment: "SPY_ALIGN",
}

interface Frame {
  def: StrategyDefinition
  bar: Bar
  price: number
  closes: number[]
  volumes: number[]
  slicedBars: Bar[]
  window: Bar[]
  swLow: number
  swHigh: number
  bias: "bullish" | "bearish"
  dol?: number
  rh?: number
  rl?: number
  i: number
  bars15m: Bar[]
  spyBars: Bar[]
  indicatorCache: Map<string, number | boolean>
}

function indicatorKey(ref: IndicatorRef): string {
  return JSON.stringify(ref)
}

function computeIndicator(ref: IndicatorRef, f: Frame): number | boolean {
  const key = indicatorKey(ref)
  const cached = f.indicatorCache.get(key)
  if (cached !== undefined) return cached

  let value: number | boolean
  switch (ref.kind) {
    case "price":
      value = f.price
      break
    case "rsi":
      value = calcRSI(f.closes, ref.period)
      break
    case "ema":
      value = calcEMA(f.closes, ref.period).slice(-1)[0]
      break
    case "volume_ratio": {
      const volMA = calcVolMA(f.volumes, ref.period).slice(-1)[0]
      value = Number.isNaN(volMA) ? NaN : f.bar.v / volMA
      break
    }
    case "atr_pct": {
      const atr = calcATR(f.slicedBars, ref.period).slice(-1)[0]
      value = Number.isNaN(atr) ? NaN : atr / f.price
      break
    }
    case "body_size_ratio": {
      const bodyAvg = calcBodyAvg(f.slicedBars, ref.period).slice(-1)[0]
      const body = Math.abs(f.bar.c - f.bar.o)
      // Legacy semantics: an undefined/zero bodyAvg means the gate doesn't
      // apply at all (checkBotSignal skips the check entirely), not that
      // it fails — 0 makes any lte(threshold) comparison pass naturally.
      value = (Number.isNaN(bodyAvg) || bodyAvg <= 0) ? 0 : body / bodyAvg
      break
    }
    case "ifvg":
      value = findIFVG(f.window, f.price, f.bias)
      break
    case "bos":
      value = detectBOS(f.window, f.price, f.bias)
      break
    case "ote":
      value = checkOTE(f.swLow, f.swHigh, f.price, f.bias)
      break
    case "fvg":
      value = findFVG(f.window, f.bias).length > 0
      break
    case "equilibrium":
      value = (f.rh !== undefined && f.rl !== undefined) ? checkEquilibrium(f.rh, f.rl, f.price) : false
      break
    case "order_block":
      value = findOrderBlock(f.window, f.bias).length > 0
      break
    case "breaker":
      value = findBreaker(f.window, f.price, f.bias)
      break
    case "liquidity_raid":
      value = (f.rh !== undefined && f.rl !== undefined)
        ? checkLiquidityRaid(f.bars15m, f.i, f.bias, f.rh, f.rl)
        : false
      break
    case "prev_candle_confirms":
      if (f.i === 0) { value = true; break }
      { const prev = f.bars15m[f.i - 1]
        value = f.bias === "bullish" ? prev.c > prev.o : prev.c < prev.o }
      break
    case "spy_alignment": {
      const trend = getSpyTrend(f.spyBars, f.bar.t)
      value = trend === "neutral" || trend === f.bias
      break
    }
  }
  f.indicatorCache.set(key, value)
  return value
}

/** Evaluates a condition, returning both its result and the labels of every
 *  boolean detector that fired true anywhere within it (for revTags/contTags). */
function evalCondition(cond: Condition, f: Frame): { result: boolean; fired: string[] } {
  switch (cond.op) {
    case "gt": case "gte": case "lt": case "lte": {
      const v = computeIndicator(cond.indicator, f) as number
      const result =
        cond.op === "gt" ? v > cond.value :
        cond.op === "gte" ? v >= cond.value :
        cond.op === "lt" ? v < cond.value :
        v <= cond.value
      return { result, fired: [] }
    }
    case "true_when": {
      const v = computeIndicator(cond.indicator, f) as boolean
      const label = TAG_LABELS[cond.indicator.kind] ?? cond.indicator.kind.toUpperCase()
      return { result: v, fired: v ? [label] : [] }
    }
    case "trend_favors_bias": {
      const emaFast = calcEMA(f.closes, cond.emaFastPeriod).slice(-1)[0]
      const emaSlow = calcEMA(f.closes, cond.emaSlowPeriod).slice(-1)[0]
      if (Number.isNaN(emaFast) || Number.isNaN(emaSlow)) return { result: false, fired: [] }
      const result = f.bias === "bullish"
        ? f.price > emaFast && emaFast > emaSlow
        : f.price < emaFast && emaFast < emaSlow
      return { result, fired: [] }
    }
    case "and": {
      const fired: string[] = []
      let result = true
      for (const c of cond.conditions) {
        const r = evalCondition(c, f)
        fired.push(...r.fired)
        if (!r.result) result = false
      }
      return { result, fired }
    }
    case "or": {
      const fired: string[] = []
      let result = false
      for (const c of cond.conditions) {
        const r = evalCondition(c, f)
        fired.push(...r.fired)
        if (r.result) result = true
      }
      return { result, fired }
    }
    case "not": {
      const r = evalCondition(cond.condition, f)
      return { result: !r.result, fired: [] } // negated branch's fires aren't meaningful tags
    }
    case "count_at_least": {
      const fired: string[] = []
      let count = 0
      for (const c of cond.conditions) {
        const r = evalCondition(c, f)
        fired.push(...r.fired)
        if (r.result) count++
      }
      return { result: count >= cond.min, fired }
    }
  }
}

const MIN_WARMUP_BARS = 35

export function evaluateStrategy(def: StrategyDefinition, ctx: EvalContext): InterpretedSignal | null {
  const { bars15m, dailyBars, spyBars, i, symbol } = ctx
  if (i < MIN_WARMUP_BARS) return null
  const bar = bars15m[i]
  const price = bar.c
  if (price < def.entry.minEntryPrice) return null

  const slicedBars = bars15m.slice(0, i + 1)
  const closes = slicedBars.map(b => b.c)
  const volumes = slicedBars.map(b => b.v)

  let bias: "bullish" | "bearish"
  let dol: number | undefined, rh: number | undefined, rl: number | undefined
  if (def.entry.biasSource === "fixed_long") {
    bias = "bullish"
  } else if (def.entry.biasSource === "fixed_short") {
    bias = "bearish"
  } else {
    // "daily_bias" and "both" both resolve direction via the SMC daily-bias
    // engine — "both" just means "don't force a fixed side," which is
    // already what the bias engine does by picking whichever side the
    // prior day's structure favors.
    const biasData = getDailyBias(dailyBars, price, bar.t)
    if (!biasData) return null
    bias = biasData.bias
    dol = biasData.dol; rh = biasData.rh; rl = biasData.rl
  }

  if (def.entry.requireSpyAlignment) {
    const trend = getSpyTrend(spyBars, bar.t)
    if (trend !== "neutral" && trend !== bias) return null
  }

  const window = bars15m.slice(Math.max(0, i - 30), i + 1)
  const swLow = Math.min(...window.map(b => b.l))
  const swHigh = Math.max(...window.map(b => b.h))

  const frame: Frame = {
    def, bar, price, closes, volumes, slicedBars, window, swLow, swHigh,
    bias, dol, rh, rl, i, bars15m, spyBars,
    indicatorCache: new Map(),
  }

  for (const filter of def.entry.filters) {
    if (!evalCondition(filter, frame).result) return null
  }
  const entryEval = evalCondition(def.entry.condition, frame)
  if (!entryEval.result) return null

  // contTags only comes from confluence-*group* filters (count_at_least),
  // not every true_when gate — a plain single-condition filter like
  // "liquidity raid must have happened" is a go/no-go gate, not a tag to
  // surface in the reasoning display, and legacy's contTags only ever held
  // the FVG/EQ/OB/Breaker continuation-confluence group's fired members.
  const contTags = def.entry.filters
    .filter(f => f.op === "count_at_least")
    .flatMap(f => evalCondition(f, frame).fired)

  // ── Stop ──
  let sl: number
  if (def.exit.stop.mode === "structure") {
    sl = getStructureStop(window, price, bias)
  } else if (def.exit.stop.mode === "atr_multiple") {
    const atr = calcATR(slicedBars, def.exit.stop.atrPeriod).slice(-1)[0]
    if (Number.isNaN(atr)) return null
    sl = bias === "bullish" ? price - atr * def.exit.stop.value : price + atr * def.exit.stop.value
  } else {
    sl = bias === "bullish" ? price * (1 - def.exit.stop.value) : price * (1 + def.exit.stop.value)
  }
  const slDist = Math.abs(price - sl)
  if (def.exit.maxStopRiskPct !== undefined && slDist / price > def.exit.maxStopRiskPct) return null

  // ── Target ──
  let tp: number
  if (def.exit.target.mode === "dol_or_pct") {
    if (dol === undefined) return null // dol_or_pct requires the daily-bias engine
    const pct = def.exit.target.value
    tp = bias === "bullish"
      ? (dol > price * (1 + pct * 0.5) ? dol : price * (1 + pct))
      : (dol < price * (1 - pct * 0.5) ? dol : price * (1 - pct))
  } else if (def.exit.target.mode === "r_multiple") {
    tp = bias === "bullish" ? price + def.exit.target.value * slDist : price - def.exit.target.value * slDist
  } else {
    tp = bias === "bullish" ? price * (1 + def.exit.target.value) : price * (1 - def.exit.target.value)
  }

  const tpDist = Math.abs(tp - price)
  if (slDist <= 0 || tpDist / slDist < def.exit.minRR) return null

  return {
    symbol, bias, price,
    rsi: Math.round(calcRSI(closes) * 10) / 10,
    sl: Math.round(sl * 10000) / 10000,
    tp: Math.round(tp * 10000) / 10000,
    rr: Math.round((tpDist / slDist) * 100) / 100,
    dol: dol !== undefined ? Math.round(dol * 10000) / 10000 : 0,
    slDist,
    revTags: entryEval.fired,
    contTags,
  }
}
