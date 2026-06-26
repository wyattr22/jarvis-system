import { db } from "@/lib/db/client"

export async function GET() {
  const agentsResult = await db.execute({
    sql: `SELECT a.id, a.name, a.role, a.model_id, a.model_family, a.status,
                 a.spawned_at,
                 COUNT(DISTINCT ao.id) as output_count,
                 AVG(CASE WHEN as2.pnl_impact IS NOT NULL THEN as2.pnl_impact ELSE NULL END) as avg_pnl_impact,
                 SUM(as2.type_1_error) as total_type1,
                 SUM(as2.type_2_error) as total_type2
          FROM agents a
          LEFT JOIN agent_outputs ao ON ao.agent_id = a.id
          LEFT JOIN agent_scores as2 ON as2.agent_id = a.id
          GROUP BY a.id
          ORDER BY a.role, a.name`,
    args: [],
  })

  const recentOutputs = await db.execute({
    sql: `SELECT ao.agent_id, ao.output_json, ao.created_at, ao.related_id,
                 as2.pnl_impact, as2.type_1_error, as2.type_2_error, as2.outcome
          FROM agent_outputs ao
          LEFT JOIN agent_scores as2 ON as2.agent_id = ao.agent_id AND as2.output_id = ao.id
          WHERE ao.created_at > ?
          ORDER BY ao.created_at DESC
          LIMIT 100`,
    args: [Date.now() - 90 * 24 * 60 * 60 * 1000],
  })

  return Response.json({
    agents: agentsResult.rows,
    recentOutputs: recentOutputs.rows,
  })
}
