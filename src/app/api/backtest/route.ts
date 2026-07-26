import { db } from "@/lib/db/client"
import { runWalkForward, backtestWalkForward, type SimTrade } from "@/lib/validation/walk-forward"
import { getBars } from "@/lib/data/alpaca"
import { DEFAULT_PARAMS, type StrategyParams } from "@/lib/backtest/bot-strategy"
import { simulateSymbol, DEFAULT_MAX_HOLD_BARS } from "@/lib/strategy-engine/backtest-runner"
import { getActiveUniverse } from "@/lib/universe/store"

const DEFAULT_SYMBOL_COUNT = 30   // universe top-N when no custom symbols given

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
