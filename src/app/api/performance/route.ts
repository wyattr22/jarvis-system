// GET /api/performance — rolled-up P&L stats from the trades table.
// Read-only, no auth (dashboard endpoint).

import { db } from "@/lib/db/client"

const DAY = 24 * 60 * 60 * 1000

export async function GET(req: Request) {
  const url = new URL(req.url)
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days") ?? 90)))
  const since = Date.now() - days * DAY

  let trades: Array<{ r_multiple: number; pnl: number; opened_at: number; closed_at: number | null }> = []
  try {
    const r = await db.execute({
      sql: `SELECT r_multiple, pnl, opened_at, closed_at
            FROM trades
            WHERE r_multiple IS NOT NULL AND opened_at >= ?
            ORDER BY opened_at ASC`,
      args: [since],
    })
    trades = r.rows.map(row => row as unknown as typeof trades[number])
  } catch {
    return Response.json({ ok: false, error: "trades table query failed" }, { status: 500 })
  }

  if (trades.length === 0) {
    return Response.json({
      ok: true,
      days_back: days,
      summary: null,
      daily: [],
      message: "no closed trades in window",
    })
  }

  // Summary stats
  const totalTrades = trades.length
  const wins = trades.filter(t => Number(t.r_multiple) > 0).length
  const winRate = wins / totalTrades
  const totalPnl = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
  const avgR = trades.reduce((s, t) => s + Number(t.r_multiple), 0) / totalTrades
  const rValues = trades.map(t => Number(t.r_multiple))
  const meanR = rValues.reduce((a, b) => a + b, 0) / rValues.length
  const variance = rValues.reduce((s, r) => s + (r - meanR) ** 2, 0) / rValues.length
  const stdDev = Math.sqrt(variance)
  // Annualised Sharpe assuming ~250 trading days
  const sharpe = stdDev > 0 ? (meanR / stdDev) * Math.sqrt(250) : 0

  // Equity curve (cumulative P&L by day)
  const dailyMap = new Map<string, number>()
  for (const t of trades) {
    const day = new Date(t.opened_at).toISOString().slice(0, 10)
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + Number(t.pnl ?? 0))
  }
  let cumPnl = 0
  const daily = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, pnl]) => {
    cumPnl += pnl
    return { day, daily_pnl: pnl, cumulative_pnl: cumPnl }
  })

  // Max drawdown from peak
  let peak = 0
  let maxDD = 0
  for (const d of daily) {
    if (d.cumulative_pnl > peak) peak = d.cumulative_pnl
    const dd = peak - d.cumulative_pnl
    if (dd > maxDD) maxDD = dd
  }

  // Per-strategy breakdown via attribution table.
  // contribution_pct weights each trade's P&L across strategies that influenced it.
  let byStrategy: Array<{
    strategy_id: string
    trades: number
    wins: number
    weighted_pnl: number
    avg_r: number
  }> = []
  try {
    const r = await db.execute({
      sql: `
        SELECT a.strategy_id,
               COUNT(DISTINCT t.id) AS n,
               SUM(CASE WHEN t.r_multiple > 0 THEN 1 ELSE 0 END) AS wins,
               SUM(t.pnl * COALESCE(a.contribution_pct, 1.0)) AS weighted_pnl,
               AVG(t.r_multiple) AS avg_r
        FROM trades t
        JOIN attribution a ON a.trade_id = t.id
        WHERE t.r_multiple IS NOT NULL AND t.opened_at >= ?
        GROUP BY a.strategy_id
        ORDER BY weighted_pnl DESC
      `,
      args: [since],
    })
    byStrategy = r.rows.map(row => {
      const r = row as unknown as {
        strategy_id: string
        n: number
        wins: number
        weighted_pnl: number
        avg_r: number
      }
      return {
        strategy_id: String(r.strategy_id),
        trades: Number(r.n),
        wins: Number(r.wins),
        weighted_pnl: Number(r.weighted_pnl ?? 0),
        avg_r: Number(r.avg_r ?? 0),
      }
    })
  } catch { /* attribution table may be empty */ }

  return Response.json({
    ok: true,
    days_back: days,
    summary: {
      total_trades: totalTrades,
      wins,
      losses: totalTrades - wins,
      win_rate: winRate,
      total_pnl: totalPnl,
      avg_r: avgR,
      std_dev_r: stdDev,
      sharpe_annualised: sharpe,
      max_drawdown_usd: maxDD,
    },
    daily,
    by_strategy: byStrategy,
  })
}
