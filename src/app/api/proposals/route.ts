import { db } from "@/lib/db/client"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") ?? "pending"
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100)

  const result = await db.execute({
    sql: `SELECT id, strategy_id, hypothesis, ensemble_confidence, critic_scores_json,
                 risk_verdict, status, reviewer_notes, created_at, decided_at,
                 walk_forward_result_json, stability_score, causality_score,
                 proposed_change_json
          FROM proposals
          WHERE status = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [status, limit],
  })

  return Response.json({ proposals: result.rows })
}
