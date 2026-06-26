import { db } from "@/lib/db/client"

export async function GET() {
  const result = await db.execute({
    sql: `SELECT s.*,
                 COUNT(DISTINCT sig.id) as signal_count,
                 COUNT(DISTINCT t.id) as trade_count,
                 AVG(t.r_multiple) as avg_r,
                 SUM(CASE WHEN t.r_multiple > 0 THEN 1 ELSE 0 END) * 1.0 /
                   NULLIF(COUNT(CASE WHEN t.r_multiple IS NOT NULL THEN 1 END), 0) as win_rate
          FROM strategies s
          LEFT JOIN signals sig ON sig.strategy_id = s.id
          LEFT JOIN trades t ON t.signal_id = sig.id AND t.r_multiple IS NOT NULL
          GROUP BY s.id
          ORDER BY s.created_at DESC`,
    args: [],
  })

  return Response.json({ strategies: result.rows })
}
