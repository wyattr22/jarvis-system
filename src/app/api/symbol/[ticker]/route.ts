// GET /api/symbol/[ticker] — aggregated drill-down for one symbol.
// Returns: opportunities (recent + open), allocations, signals, memories
// tagged with the ticker, recent trades, current position if any.

import { db } from "@/lib/db/client"
import { getAdapter } from "@/lib/brokers"

export async function GET(_req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params
  const sym = ticker.toUpperCase()
  if (!/^[A-Z]{1,8}$/.test(sym)) {
    return Response.json({ error: "invalid ticker" }, { status: 400 })
  }

  // Run all queries in parallel — they're independent
  const [oppsR, allocsR, signalsR, memsR, tradesR, livePosition] = await Promise.all([
    db.execute({
      sql: `SELECT * FROM opportunities WHERE instrument = ? ORDER BY created_at DESC LIMIT 50`,
      args: [sym],
    }).catch(() => ({ rows: [] })),
    db.execute({
      sql: `SELECT a.* FROM allocations a
            JOIN opportunities o ON o.id = a.opportunity_id
            WHERE o.instrument = ?
            ORDER BY a.decided_at DESC LIMIT 30`,
      args: [sym],
    }).catch(() => ({ rows: [] })),
    db.execute({
      sql: `SELECT * FROM signals WHERE instrument = ? ORDER BY created_at DESC LIMIT 30`,
      args: [sym],
    }).catch(() => ({ rows: [] })),
    db.execute({
      sql: `SELECT * FROM jarvis_memory WHERE tags LIKE ? ORDER BY importance DESC, last_accessed DESC LIMIT 20`,
      args: [`%"${sym}"%`],
    }).catch(() => ({ rows: [] })),
    db.execute({
      sql: `SELECT * FROM trades WHERE instrument = ? ORDER BY opened_at DESC LIMIT 30`,
      args: [sym],
    }).catch(() => ({ rows: [] })),
    (async () => {
      try {
        const positions = await getAdapter("equity").positions()
        return positions.find(p => p.symbol.toUpperCase() === sym) ?? null
      } catch { return null }
    })(),
  ])

  // Summary stats from recent trades
  const trades = tradesR.rows
    .map(r => r as unknown as { r_multiple: number | null; pnl: number | null })
    .filter(t => t.r_multiple !== null)

  let tradeStats = null
  if (trades.length > 0) {
    const total = trades.length
    const wins = trades.filter(t => Number(t.r_multiple) > 0).length
    const totalPnl = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
    const avgR = trades.reduce((s, t) => s + Number(t.r_multiple), 0) / total
    tradeStats = { total, wins, losses: total - wins, win_rate: wins / total, total_pnl: totalPnl, avg_r: avgR }
  }

  return Response.json({
    ticker: sym,
    opportunities: oppsR.rows,
    allocations: allocsR.rows,
    signals: signalsR.rows,
    memories: memsR.rows,
    trades: tradesR.rows,
    trade_stats: tradeStats,
    live_position: livePosition,
  })
}
