import { db } from "@/lib/db/client"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const strategyId = searchParams.get("strategyId")

  const whereClause = strategyId ? "WHERE strategy_id = ?" : ""
  const args = strategyId ? [strategyId] : []

  const driftResult = await db.execute({
    sql: `SELECT strategy_id, window_start, window_end, expected_r, actual_r,
                 divergence_sigma, auto_paused
          FROM drift_log
          ${whereClause}
          ORDER BY window_start DESC
          LIMIT 200`,
    args,
  })

  // Get trade R over time per strategy (via signals → trades)
  const tradesResult = await db.execute({
    sql: `SELECT sig.strategy_id, t.r_multiple, t.opened_at
          FROM trades t
          JOIN signals sig ON t.signal_id = sig.id
          WHERE t.r_multiple IS NOT NULL
            ${strategyId ? "AND sig.strategy_id = ?" : ""}
          ORDER BY t.opened_at DESC
          LIMIT 500`,
    args: strategyId ? [strategyId] : [],
  })

  const strategiesResult = await db.execute({
    sql: "SELECT id, name FROM strategies ORDER BY name",
    args: [],
  })

  return Response.json({
    driftLog: driftResult.rows,
    trades: tradesResult.rows,
    strategies: strategiesResult.rows,
  })
}
