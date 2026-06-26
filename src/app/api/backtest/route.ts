import { db } from "@/lib/db/client"
import { runWalkForward } from "@/lib/validation/walk-forward"
import { getBars } from "@/lib/data/alpaca"
import { UNIVERSE, checkBotSignal, TAKE_PROFIT_PCT, MAX_STOP_RISK_PCT } from "@/lib/backtest/bot-strategy"

const MAX_HOLD_BARS = 20  // ~5 hours on 15m
const RISK_PER_TRADE = 100  // $100 notional risk per trade for PnL display

interface SimTrade {
  instrument: string
  direction: string
  r_multiple: number
  pnl: number | null
  opened_at: number
  closed_at: number | null
  regime_tag: string | null
}

// ── Walk-forward on in-memory trades ─────────────────────────
function inMemoryWalkForward(trades: SimTrade[], trainMonths = 2, testMonths = 1) {
  if (trades.length < 20) {
    return { windows: [], avgR: 0, avgWinRate: 0, avgSharpe: 0, consistent: false, passedMinWindows: false }
  }

  const MS_MONTH = 30 * 86_400_000
  const first    = Math.min(...trades.map(t => t.opened_at))
  const last     = Math.max(...trades.map(t => t.opened_at))

  const windows: Array<{
    trainStart: number; trainEnd: number
    testStart: number; testEnd: number
    testR: number; testWinRate: number; testSharpe: number; passed: boolean
  }> = []

  let cursor = first
  while (cursor + (trainMonths + testMonths) * MS_MONTH <= last) {
    const testStart = cursor + trainMonths * MS_MONTH
    const testEnd   = testStart + testMonths * MS_MONTH
    const batch     = trades.filter(t => t.opened_at >= testStart && t.opened_at < testEnd)

    if (batch.length >= 3) {
      const rs      = batch.map(t => t.r_multiple)
      const avgR    = rs.reduce((s, r) => s + r, 0) / rs.length
      const winRate = rs.filter(r => r > 0).length / rs.length
      const std     = Math.sqrt(rs.reduce((s, r) => s + (r - avgR) ** 2, 0) / rs.length)
      windows.push({
        trainStart: cursor, trainEnd: testStart, testStart, testEnd,
        testR: avgR, testWinRate: winRate,
        testSharpe: std > 0 ? avgR / std : 0,
        passed: avgR > 0 && winRate > 0.40,
      })
    }
    cursor += testMonths * MS_MONTH
  }

  if (!windows.length) {
    return { windows: [], avgR: 0, avgWinRate: 0, avgSharpe: 0, consistent: false, passedMinWindows: false }
  }

  const avgR      = windows.reduce((s, w) => s + w.testR, 0) / windows.length
  const avgWinRate = windows.reduce((s, w) => s + w.testWinRate, 0) / windows.length
  const avgSharpe  = windows.reduce((s, w) => s + w.testSharpe, 0) / windows.length
  const rs = windows.map(w => w.testR)
  const consistent = Math.max(...rs) <= Math.abs(Math.min(...rs)) * 1.5 + 0.1 || windows.every(w => w.passed)
  return { windows, avgR, avgWinRate, avgSharpe, consistent, passedMinWindows: windows.length >= 4 }
}

// ── Historical simulation for one symbol using exact bot.py logic ──
async function simulateSymbol(
  symbol: string,
  spyBars: ReturnType<typeof getBars> extends Promise<infer T> ? T : never
): Promise<SimTrade[]> {
  const [bars15m, dailyBars] = await Promise.all([
    getBars(symbol, '15Min', 2000, 180).catch(() => [] as Awaited<ReturnType<typeof getBars>>),
    getBars(symbol, '1Day', 250, 365).catch(() => [] as Awaited<ReturnType<typeof getBars>>),
  ])

  if (bars15m.length < 50 || dailyBars.length < 5) return []

  const trades: SimTrade[] = []
  let skipUntil = 0

  for (let i = 35; i < bars15m.length - MAX_HOLD_BARS; i++) {
    if (i < skipUntil) continue

    const signal = checkBotSignal(bars15m, dailyBars, spyBars, i, symbol)
    if (!signal) continue

    // Enter at next bar's open
    const entryBar = bars15m[i + 1]
    if (!entryBar) continue
    const entry = entryBar.o
    const sl    = signal.bias === 'bullish'
      ? entry * (1 - MAX_STOP_RISK_PCT)
      : entry * (1 + MAX_STOP_RISK_PCT)
    const tp = signal.tp

    let r_multiple = 0
    let exitIdx    = i + 1
    let exited     = false

    for (let j = i + 1; j < Math.min(i + 1 + MAX_HOLD_BARS, bars15m.length); j++) {
      const bar = bars15m[j]
      exitIdx = j
      if (signal.bias === 'bullish') {
        if (bar.l <= sl) { r_multiple = -1;                    exited = true; break }
        if (bar.h >= tp) { r_multiple = TAKE_PROFIT_PCT / MAX_STOP_RISK_PCT; exited = true; break }
      } else {
        if (bar.h >= sl) { r_multiple = -1;                    exited = true; break }
        if (bar.l <= tp) { r_multiple = TAKE_PROFIT_PCT / MAX_STOP_RISK_PCT; exited = true; break }
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
  const { strategyId } = await req.json()
  if (!strategyId) return Response.json({ error: 'strategyId required' }, { status: 400 })

  try {
    // Prefer real live trades if they exist
    const dbResult = await runWalkForward(strategyId).catch(() => null)
    if (dbResult && dbResult.windows.length > 0) {
      return Response.json({ ok: true, result: dbResult, source: 'live' })
    }

    // No live data yet — run full historical simulation using exact bot.py logic
    // Fetch SPY bars once, shared across all symbol sims for the trend filter
    const spyBars = await getBars('SPY', '15Min', 2000, 180).catch(() => [] as Awaited<ReturnType<typeof getBars>>)

    const symbolResults = await Promise.all(
      UNIVERSE.map(sym => simulateSymbol(sym, spyBars).catch(() => [] as SimTrade[]))
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

    const result = inMemoryWalkForward(allTrades)
    const wins = allTrades.filter(t => t.r_multiple > 0).length
    return Response.json({
      ok: true, result, trades: allTrades, source: 'sim',
      message: `${allTrades.length} simulated trades (${wins}W/${allTrades.length - wins}L) · exact bot.py logic · ${UNIVERSE.length} symbols · 15m bars`,
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
