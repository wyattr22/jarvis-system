import { db } from "@/lib/db/client"

export async function GET() {
  const result = await db.execute({
    sql: `SELECT e.*,
                 p.hypothesis
          FROM experiments e
          LEFT JOIN proposals p ON p.id = e.proposal_id
          ORDER BY e.started_at DESC`,
    args: [],
  })
  return Response.json({ experiments: result.rows })
}
