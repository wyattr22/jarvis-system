// Performance MCP tools.
//
// performance.summary returns the same rolled-up trade stats the
// /performance dashboard shows. Useful for "how have we been doing?" chats.

import { z, registerTool } from "@/lib/mcp/server"
import { db } from "@/lib/db/client"

const DAY = 24 * 60 * 60 * 1000

registerTool({
  name: "performance.summary",
  description: "Trading performance over a window: total trades, win rate, total P&L, avg R, annualised Sharpe, max drawdown. Defaults to 90 days.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(365).default(90),
  }),
  requiredScope: "read:account",
  handler: async (input: { days: number }) => {
    const since = Date.now() - input.days * DAY
    const r = await db.execute({
      sql: `SELECT r_multiple, pnl FROM trades
            WHERE r_multiple IS NOT NULL AND opened_at >= ?`,
      args: [since],
    })
    if (r.rows.length === 0) {
      return { days: input.days, trades: 0, message: "no closed trades in window" }
    }
    const trades = r.rows.map(row => row as unknown as { r_multiple: number; pnl: number })
    const total = trades.length
    const wins = trades.filter(t => Number(t.r_multiple) > 0).length
    const totalPnl = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
    const meanR = trades.reduce((s, t) => s + Number(t.r_multiple), 0) / total
    const variance = trades.reduce((s, t) => s + (Number(t.r_multiple) - meanR) ** 2, 0) / total
    const stdDev = Math.sqrt(variance)
    const sharpe = stdDev > 0 ? (meanR / stdDev) * Math.sqrt(250) : 0

    return {
      days: input.days,
      trades: total,
      wins,
      losses: total - wins,
      win_rate: wins / total,
      total_pnl: totalPnl,
      avg_r: meanR,
      std_dev_r: stdDev,
      sharpe_annualised: sharpe,
    }
  },
})
