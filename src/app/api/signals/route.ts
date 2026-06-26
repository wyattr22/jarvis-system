import { db } from "@/lib/db/client"

export async function GET() {
  const result = await db.execute({
    sql: `SELECT s.id, s.strategy_id, s.instrument, s.direction, s.entry, s.stop, s.target,
                 s.confidence, s.status, s.created_at,
                 t.r_multiple, t.pnl, t.fill_price, t.exit_price
          FROM signals s
          LEFT JOIN trades t ON t.signal_id = s.id
          ORDER BY s.created_at DESC
          LIMIT 100`,
    args: [],
  })
  return Response.json({ signals: result.rows })
}
