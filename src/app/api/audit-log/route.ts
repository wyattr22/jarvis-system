import { db } from "@/lib/db/client"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const actor = searchParams.get("actor")
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500)

  const whereClause = actor ? "WHERE actor = ?" : ""
  const args = actor ? [actor, limit] : [limit]

  const result = await db.execute({
    sql: `SELECT id, actor, action, details_json, created_at
          FROM audit_log
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT ?`,
    args,
  })

  return Response.json({ entries: result.rows })
}
