import type { Bar } from "@/lib/data/alpaca"

export interface FeatureSet {
  instrument: string
  timestamp: number
  features: Record<string, number>
}

// ── Volatility ────────────────────────────────────────────────
function atr(bars: Bar[], period = 14): number {
  if (bars.length < 2) return 0
  const trs = bars.slice(1).map((b, i) => {
    const prev = bars[i]
    return Math.max(b.h - b.l, Math.abs(b.h - prev.c), Math.abs(b.l - prev.c))
  })
  return trs.slice(-period).reduce((s, v) => s + v, 0) / Math.min(period, trs.length)
}

function parkinson(bars: Bar[]): number {
  if (bars.length === 0) return 0
  const vals = bars.map(b => Math.pow(Math.log(b.h / b.l), 2))
  return Math.sqrt(vals.reduce((s, v) => s + v, 0) / (4 * Math.log(2) * bars.length))
}

function garmanKlass(bars: Bar[]): number {
  if (bars.length === 0) return 0
  const vals = bars.map(b => {
    const hl = 0.5 * Math.pow(Math.log(b.h / b.l), 2)
    const co = (2 * Math.log(2) - 1) * Math.pow(Math.log(b.c / b.o), 2)
    return hl - co
  })
  return Math.sqrt(vals.reduce((s, v) => s + v, 0) / bars.length)
}

function realizedVol(closes: number[], period: number): number {
  if (closes.length < 2) return 0
  const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]))
  const slice = returns.slice(-period)
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length
  const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / slice.length
  return Math.sqrt(variance * 252)
}

// ── Trend ─────────────────────────────────────────────────────
function sma(values: number[], period: number): number {
  const slice = values.slice(-period)
  return slice.reduce((s, v) => s + v, 0) / slice.length
}

function adx(bars: Bar[], period = 14): number {
  if (bars.length < period + 1) return 0
  const plusDM: number[] = []
  const minusDM: number[] = []
  const tr: number[] = []

  for (let i = 1; i < bars.length; i++) {
    const curr = bars[i], prev = bars[i - 1]
    const upMove = curr.h - prev.h
    const downMove = prev.l - curr.l
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
    tr.push(Math.max(curr.h - curr.l, Math.abs(curr.h - prev.c), Math.abs(curr.l - prev.c)))
  }

  const smoothedTR = tr.slice(-period).reduce((s, v) => s + v, 0)
  const smoothedPlus = plusDM.slice(-period).reduce((s, v) => s + v, 0)
  const smoothedMinus = minusDM.slice(-period).reduce((s, v) => s + v, 0)

  if (smoothedTR === 0) return 0
  const plusDI = (smoothedPlus / smoothedTR) * 100
  const minusDI = (smoothedMinus / smoothedTR) * 100
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI + 1e-10) * 100
  return dx
}

function regressionSlope(values: number[], period: number): number {
  const slice = values.slice(-period)
  const n = slice.length
  if (n < 2) return 0
  const xMean = (n - 1) / 2
  const yMean = slice.reduce((s, v) => s + v, 0) / n
  let num = 0, den = 0
  slice.forEach((y, x) => {
    num += (x - xMean) * (y - yMean)
    den += Math.pow(x - xMean, 2)
  })
  return den === 0 ? 0 : num / den
}

// ── Momentum ──────────────────────────────────────────────────
function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  const gains: number[] = [], losses: number[] = []
  for (let i = 1; i <= period; i++) {
    const diff = closes[closes.length - period - 1 + i] - closes[closes.length - period - 2 + i]
    gains.push(Math.max(diff, 0))
    losses.push(Math.max(-diff, 0))
  }
  const avgGain = gains.reduce((s, v) => s + v, 0) / period
  const avgLoss = losses.reduce((s, v) => s + v, 0) / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function roc(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0
  const prev = closes[closes.length - 1 - period]
  if (prev === 0) return 0
  return (closes[closes.length - 1] - prev) / prev * 100
}

function macdComponents(closes: number[]): { macd: number; signal: number; hist: number } {
  const ema = (data: number[], period: number) => {
    const k = 2 / (period + 1)
    return data.reduce((prev, curr, i) => (i === 0 ? curr : curr * k + prev * (1 - k)))
  }
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 }
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const macd = ema12 - ema26
  const signal = macd * (2 / 10)
  return { macd, signal, hist: macd - signal }
}

function stochastic(bars: Bar[], period = 14): { k: number; d: number } {
  const slice = bars.slice(-period)
  if (slice.length === 0) return { k: 50, d: 50 }
  const high = Math.max(...slice.map(b => b.h))
  const low = Math.min(...slice.map(b => b.l))
  const curr = slice[slice.length - 1].c
  const k = high === low ? 50 : ((curr - low) / (high - low)) * 100
  return { k, d: k }
}

// ── Volume ────────────────────────────────────────────────────
function relativeVolume(bars: Bar[], period = 20): number {
  if (bars.length < 2) return 1
  const avgVol = bars.slice(-period - 1, -1).reduce((s, b) => s + b.v, 0) / Math.min(period, bars.length - 1)
  return avgVol === 0 ? 1 : bars[bars.length - 1].v / avgVol
}

function vwapDistance(bars: Bar[]): number {
  if (bars.length === 0) return 0
  const sessionBars = bars.slice(-78) // approx 1 trading day of 5m bars
  const totalVol = sessionBars.reduce((s, b) => s + b.v, 0)
  if (totalVol === 0) return 0
  const vwap = sessionBars.reduce((s, b) => s + b.vw * b.v, 0) / totalVol
  const last = bars[bars.length - 1].c
  return (last - vwap) / vwap * 100
}

// ── Structure ─────────────────────────────────────────────────
function swingHighLowDistances(bars: Bar[], lookback = 20): { toHigh: number; toLow: number } {
  const slice = bars.slice(-lookback - 1, -1)
  if (slice.length === 0) return { toHigh: 0, toLow: 0 }
  const swingHigh = Math.max(...slice.map(b => b.h))
  const swingLow = Math.min(...slice.map(b => b.l))
  const last = bars[bars.length - 1].c
  return {
    toHigh: (swingHigh - last) / last * 100,
    toLow: (last - swingLow) / last * 100,
  }
}

function fvgAge(bars: Bar[], maxAge = 20): number {
  // Find most recent FVG (gap between bar[i].h and bar[i+2].l or bar[i].l and bar[i+2].h)
  for (let i = bars.length - 3; i >= Math.max(0, bars.length - maxAge); i--) {
    const bullFvg = bars[i + 2].l > bars[i].h
    const bearFvg = bars[i + 2].h < bars[i].l
    if (bullFvg || bearFvg) return bars.length - 3 - i
  }
  return maxAge
}

function bosDistance(bars: Bar[], lookback = 30): number {
  // BOS: close breaks above recent swing high or below swing low
  const slice = bars.slice(-lookback - 1, -1)
  if (slice.length < 2) return 0
  const swingHigh = Math.max(...slice.map(b => b.h))
  const last = bars[bars.length - 1].c
  return (last - swingHigh) / swingHigh * 100
}

// ── Time context ──────────────────────────────────────────────
function hourOfSession(ts: number): number {
  const d = new Date(ts)
  return d.getUTCHours() - 14 // offset to NYSE open (14:30 UTC)
}

function dayOfWeek(ts: number): number {
  return new Date(ts).getUTCDay()
}

function inKillZone(ts: number): number {
  const h = new Date(ts).getUTCHours()
  const m = new Date(ts).getUTCMinutes()
  const totalMin = h * 60 + m
  // London: 02:00-05:00 UTC, NY: 13:30-16:00 UTC
  const london = totalMin >= 120 && totalMin <= 300
  const nyOpen = totalMin >= 810 && totalMin <= 960
  return london || nyOpen ? 1 : 0
}

// ── Main compute function ─────────────────────────────────────
export function computeFeatures(instrument: string, bars: Bar[]): FeatureSet | null {
  if (bars.length < 30) return null

  const closes = bars.map(b => b.c)
  const last = bars[bars.length - 1]
  const ts = new Date(last.t).getTime()

  const currentAtr = atr(bars, 14)
  const atr20 = atr(bars, 20)
  const { macd, signal: macdSig, hist: macdHist } = macdComponents(closes)
  const { k: stochK, d: stochD } = stochastic(bars)
  const { toHigh, toLow } = swingHighLowDistances(bars)
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const ema9 = closes.slice(-9).reduce((p, c, i, a) => i === 0 ? c : c * (2 / 10) + p * (8 / 10))
  const ema21 = closes.slice(-21).reduce((p, c, i, a) => i === 0 ? c : c * (2 / 22) + p * (20 / 22))

  const priorDayBars = bars.slice(-2 * 78, -78) // previous session
  const priorDayRange = priorDayBars.length > 0
    ? Math.max(...priorDayBars.map(b => b.h)) - Math.min(...priorDayBars.map(b => b.l))
    : 0

  const features: Record<string, number> = {
    // Volatility
    atr_14: currentAtr,
    atr_ratio: atr20 > 0 ? currentAtr / atr20 : 1,
    parkinson: parkinson(bars.slice(-20)),
    garman_klass: garmanKlass(bars.slice(-20)),
    realized_vol_5: realizedVol(closes, 5),
    realized_vol_20: realizedVol(closes, 20),

    // Trend
    sma20_dist: sma20 > 0 ? (last.c - sma20) / sma20 * 100 : 0,
    sma50_dist: sma50 > 0 ? (last.c - sma50) / sma50 * 100 : 0,
    ema_cross: ema9 > ema21 ? 1 : -1,
    adx_14: adx(bars, 14),
    reg_slope_10: regressionSlope(closes, 10),
    reg_slope_20: regressionSlope(closes, 20),
    trend_persistence: closes.slice(-5).filter((c, i, a) => i > 0 && c > a[i - 1]).length / 4,

    // Momentum
    rsi_7: rsi(closes, 7),
    rsi_14: rsi(closes, 14),
    rsi_21: rsi(closes, 21),
    roc_5: roc(closes, 5),
    roc_10: roc(closes, 10),
    roc_20: roc(closes, 20),
    macd: macd,
    macd_signal: macdSig,
    macd_hist: macdHist,
    stoch_k: stochK,
    stoch_d: stochD,
    williams_r: stochK - 100,

    // Structure (SMC-specific)
    swing_high_dist: toHigh,
    swing_low_dist: toLow,
    session_high_dist: (last.c - Math.max(...bars.slice(-78).map(b => b.h))) / last.c * 100,
    session_low_dist: (last.c - Math.min(...bars.slice(-78).map(b => b.l))) / last.c * 100,
    fvg_age: fvgAge(bars),
    bos_distance: bosDistance(bars),
    equal_highs_proximity: toHigh < 0.1 ? 1 : 0,

    // Volume
    rel_volume: relativeVolume(bars),
    vwap_dist: vwapDistance(bars),
    vol_ratio_hl: last.h > last.l ? (last.c - last.l) / (last.h - last.l) : 0.5,

    // Time
    hour_of_session: hourOfSession(ts),
    day_of_week: dayOfWeek(ts),
    in_kill_zone: inKillZone(ts),

    // Prior day range (key SMC feature — ratio to ATR predicts win rate)
    prior_day_range: priorDayRange,
    prior_day_range_atr_ratio: currentAtr > 0 ? priorDayRange / currentAtr : 0,

    // HTF bias proxies (based on slope of longer-period SMA)
    htf_structure: regressionSlope(closes, 50) > 0 ? 1 : -1,
    daily_momentum: roc(closes, 78), // ~1 trading day of 5m bars
  }

  return { instrument, timestamp: ts, features }
}
