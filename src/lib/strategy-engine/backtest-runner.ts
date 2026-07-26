// Shared historical-simulation runner (Phase 20, extracted from the
// backtest route so the council orchestrator can backtest a brand-new
// strategy candidate through the exact same code path a human clicking
// "WALK-FORWARD" in the Strategy Builder would use — not a reimplementation.

import { getBars } from "@/lib/data/alpaca"
import { checkBotSignal, DEFAULT_PARAMS, type StrategyParams } from "@/lib/backtest/bot-strategy"
import { getSignalForStrategy } from "./dispatch"
import type { SimTrade } from "@/lib/validation/walk-forward"

export const DEFAULT_MAX_HOLD_BARS = 20  // ~5 hours on 15m
export const RISK_PER_TRADE = 100        // $100 notional risk per trade for PnL display

// When `paramOverrides` is given (the Strategy Builder's ad-hoc "tweak a
// threshold" UI, 12.6) we run the legacy algorithm directly with those
// overrides applied — that flow only ever makes sense for smc-ict-v4's own
// tunable knobs. Otherwise we dispatch by strategyId via getSignalForStrategy
// (Phase 17), which is what makes strategyId actually select behavior.
export async function simulateSymbol(
  symbol: string,
  spyBars: ReturnType<typeof getBars> extends Promise<infer T> ? T : never,
  strategyId: string,
  paramOverrides?: StrategyParams,
  maxHoldBars = DEFAULT_MAX_HOLD_BARS,
): Promise<SimTrade[]> {
  const [bars15m, dailyBars] = await Promise.all([
    getBars(symbol, '15Min', 2000, 180).catch(() => [] as Awaited<ReturnType<typeof getBars>>),
    getBars(symbol, '1Day', 250, 365).catch(() => [] as Awaited<ReturnType<typeof getBars>>),
  ])

  if (bars15m.length < 50 || dailyBars.length < 5) return []

  const trades: SimTrade[] = []
  let skipUntil = 0
  const maxStopRiskPct = paramOverrides?.maxStopRiskPct ?? DEFAULT_PARAMS.maxStopRiskPct
  const takeProfitPct = paramOverrides?.takeProfitPct ?? DEFAULT_PARAMS.takeProfitPct

  for (let i = 35; i < bars15m.length - maxHoldBars; i++) {
    if (i < skipUntil) continue

    const signal = paramOverrides
      ? checkBotSignal(bars15m, dailyBars, spyBars, i, symbol, paramOverrides)
      : await getSignalForStrategy(strategyId, bars15m, dailyBars, spyBars, i, symbol)
    if (!signal) continue

    // Enter at next bar's open
    const entryBar = bars15m[i + 1]
    if (!entryBar) continue
    const entry = entryBar.o
    const sl    = signal.bias === 'bullish'
      ? entry * (1 - maxStopRiskPct)
      : entry * (1 + maxStopRiskPct)
    const tp = signal.tp

    let r_multiple = 0
    let exitIdx    = i + 1
    let exited     = false

    for (let j = i + 1; j < Math.min(i + 1 + maxHoldBars, bars15m.length); j++) {
      const bar = bars15m[j]
      exitIdx = j
      if (signal.bias === 'bullish') {
        if (bar.l <= sl) { r_multiple = -1;                    exited = true; break }
        if (bar.h >= tp) { r_multiple = takeProfitPct / maxStopRiskPct; exited = true; break }
      } else {
        if (bar.h >= sl) { r_multiple = -1;                    exited = true; break }
        if (bar.l <= tp) { r_multiple = takeProfitPct / maxStopRiskPct; exited = true; break }
      }
    }
    if (!exited) continue

    trades.push({
      instrument: symbol,
      direction:  signal.bias === 'bullish' ? 'long' : 'short',
      r_multiple,
      pnl:        parseFloat((r_multiple * RISK_PER_TRADE).toFixed(2)),
      opened_at:  new Date(bars15m[i].t).getTime(),
      closed_at:  new Date(bars15m[exitIdx].t).getTime(),
      regime_tag: `${signal.bias} | Rev:${signal.revTags.join('+')} Cont:${signal.contTags.join('+')} RR:${signal.rr}`,
    })

    skipUntil = exitIdx + 2
  }

  return trades
}

/** Backtest a strategy across a symbol list, sharing one SPY-bars fetch. */
export async function backtestUniverse(
  strategyId: string,
  symbols: string[],
  maxHoldBars = DEFAULT_MAX_HOLD_BARS,
): Promise<SimTrade[]> {
  const spyBars = await getBars('SPY', '15Min', 2000, 180).catch(() => [] as Awaited<ReturnType<typeof getBars>>)
  const symbolResults = await Promise.all(
    symbols.map(sym => simulateSymbol(sym, spyBars, strategyId, undefined, maxHoldBars).catch(() => [] as SimTrade[]))
  )
  return symbolResults.flat().sort((a, b) => a.opened_at - b.opened_at)
}
