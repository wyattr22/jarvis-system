import { db } from "@/lib/db/client"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const actor = searchParams.get("actor")
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500)

  const whereClause = actor ? "WHERE actor = ?" : ""
  const args = actor ? [actor, limit] : [limit]

  // Column is `timestamp`; alias keeps the page contract. Selecting the
  // non-existent created_at column made this endpoint throw — the audit-log
  // page had been broken since it shipped (fixed 12.10).
  const result = await db.execute({
    sql: `SELECT id, actor, action, details_json, timestamp AS created_at
          FROM audit_log
          ${whereClause}
          ORDER BY timestamp DESC
          LIMIT ?`,
    args,
  })

  return Response.json({ entries: result.rows })
}
