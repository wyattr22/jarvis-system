import { db } from "@/lib/db/client"

export async function GET() {
  const result = await db.execute({
    sql: `SELECT md.*, a.name as target_agent_name
          FROM meta_decisions md
          LEFT JOIN agents a ON a.id = md.target_agent_id
          ORDER BY md.created_at DESC
          LIMIT 100`,
    args: [],
  })

  return Response.json({ decisions: result.rows })
}
