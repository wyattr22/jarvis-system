import { db } from "@/lib/db/client"
import { runWalkForward, backtestWalkForward, type SimTrade } from "@/lib/validation/walk-forward"
import { getBars } from "@/lib/data/alpaca"
import { checkBotSignal, DEFAULT_PARAMS, type StrategyParams } from "@/lib/backtest/bot-strategy"
import { getSignalForStrategy } from "@/lib/strategy-engine/dispatch"
import { getActiveUniverse } from "@/lib/universe/store"

const DEFAULT_MAX_HOLD_BARS = 20  // ~5 hours on 15m
const RISK_PER_TRADE = 100  // $100 notional risk per trade for PnL display
const DEFAULT_SYMBOL_COUNT = 30   // universe top-N when no custom symbols given

// ── Historical simulation for one symbol ──
// When `paramOverrides` is given (the Strategy Builder's ad-hoc "tweak a
// threshold" UI, 12.6) we run the legacy algorithm directly with those
// overrides applied — that flow only ever makes sense for smc-ict-v4's own
// tunable knobs. Otherwise (the common case, and what Phase 20's
// candidate-testing loop uses) we dispatch by strategyId via
// getSignalForStrategy (Phase 17), which is what makes strategyId actually
// select behavior instead of being accepted-but-ignored.
async function simulateSymbol(
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

// ── POST: walk-forward (live DB trades first, sim fallback) ───
export async function POST(req: Request) {
  const body = await req.json()
  const { strategyId } = body
  if (!strategyId) return Response.json({ error: 'strategyId required' }, { status: 400 })

  // Adjustable backtest (12.6): callers may override any strategy param,
  // the symbol list, and max hold bars. paramOverrides only applies to
  // smc-ict-v4's own tunable knobs directly via checkBotSignal — with no
  // overrides, strategyId dispatches to whatever logic that id resolves to
  // (Phase 17), interpreter-driven or legacy.
  const paramOverrides: StrategyParams | undefined = body.params
    ? { ...DEFAULT_PARAMS, ...body.params }
    : undefined
  const maxHoldBars = Math.min(Math.max(Number(body.maxHoldBars ?? DEFAULT_MAX_HOLD_BARS), 2), 100)
  const custom = body.params || body.symbols || body.maxHoldBars

  try {
    // Prefer real live trades if they exist — but only for the untouched strategy
    if (!custom) {
      const dbResult = await runWalkForward(strategyId).catch(() => null)
      if (dbResult && dbResult.windows.length > 0) {
        return Response.json({ ok: true, result: dbResult, source: 'live' })
      }
    }

    // No live data yet — run full historical simulation using exact bot.py logic
    // Fetch SPY bars once, shared across all symbol sims for the trend filter
    const spyBars = await getBars('SPY', '15Min', 2000, 180).catch(() => [] as Awaited<ReturnType<typeof getBars>>)

    const symbols: string[] = Array.isArray(body.symbols) && body.symbols.length
      ? body.symbols.map((x: string) => String(x).toUpperCase()).slice(0, 50)
      : await getActiveUniverse(DEFAULT_SYMBOL_COUNT)

    const symbolResults = await Promise.all(
      symbols.map(sym => simulateSymbol(sym, spyBars, strategyId, paramOverrides, maxHoldBars).catch(() => [] as SimTrade[]))
    )

    const allTrades = symbolResults
      .flat()
      .sort((a, b) => a.opened_at - b.opened_at)

    if (!allTrades.length) {
      return Response.json({
        ok: true, result: null, trades: [], source: 'sim',
        message: 'No qualifying setups found — all confluence + quality gates applied (2-of-3 reversal, 1-of-4 continuation, EMA breakout, R:R ≥ 2).',
      })
    }

    const result = backtestWalkForward(allTrades)
    const wins = allTrades.filter(t => t.r_multiple > 0).length
    return Response.json({
      ok: true, result, trades: allTrades, source: 'sim',
      message: `${allTrades.length} simulated trades (${wins}W/${allTrades.length - wins}L) · ${paramOverrides ? 'custom params' : 'strategy definition'} · ${symbols.length} symbols · 15m bars`,
    })

  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// ── GET: live DB trade history ────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const strategyId = searchParams.get("strategyId")

  const result = await db.execute({
    sql: `SELECT t.r_multiple, t.pnl, t.opened_at, t.closed_at, t.regime_tag,
                 sig.instrument, sig.direction
          FROM trades t
          JOIN signals sig ON t.signal_id = sig.id
          WHERE t.r_multiple IS NOT NULL
            ${strategyId ? "AND sig.strategy_id = ?" : ""}
          ORDER BY t.opened_at ASC
          LIMIT 1000`,
    args: strategyId ? [strategyId] : [],
  })

  const strategies = await db.execute({
    sql: "SELECT id, name FROM strategies ORDER BY name",
    args: [],
  })

  return Response.json({ trades: result.rows, strategies: strategies.rows })
}
