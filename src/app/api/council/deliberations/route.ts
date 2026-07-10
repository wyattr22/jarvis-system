// Council deliberations (12.9): recent proposals unpacked into a
// plain-English decision timeline. New cycles come with a full per-agent
// transcript (agent_outputs); older proposals fall back to the JSON columns.

import { db } from "@/lib/db/client"
import { getTranscript } from "@/lib/agents/transcript"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 50)

  const res = await db.execute({
    sql: `SELECT id, strategy_id, hypothesis, proposed_change_json, evidence_json,
                 walk_forward_result_json, critic_scores_json, ensemble_confidence,
                 risk_verdict, status, reviewer_notes, created_at
          FROM proposals ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  })

  const parse = (v: unknown) => {
    if (v === null || v === undefined) return null
    try { return JSON.parse(String(v)) } catch { return null }
  }

  const deliberations = await Promise.all(res.rows.map(async r => {
    const id = String(r.id)
    const wf = parse(r.walk_forward_result_json)
    return {
      id,
      strategy_id: r.strategy_id ? String(r.strategy_id) : null,
      created_at: Number(r.created_at),
      status: String(r.status ?? "pending"),
      hypothesis: String(r.hypothesis ?? ""),
      proposed_change: parse(r.proposed_change_json),
      evidence: parse(r.evidence_json),
      walk_forward: wf ? {
        windows: Array.isArray(wf.windows) ? wf.windows.length : 0,
        avgR: typeof wf.avgR === "number" ? Number(wf.avgR.toFixed(3)) : null,
        avgWinRate: typeof wf.avgWinRate === "number" ? Number(wf.avgWinRate.toFixed(3)) : null,
        consistent: Boolean(wf.consistent),
      } : null,
      critics: parse(r.critic_scores_json),
      ensemble_confidence: r.ensemble_confidence !== null ? Number(r.ensemble_confidence) : null,
      risk_verdict: r.risk_verdict ? String(r.risk_verdict) : null,
      decision: r.reviewer_notes ? String(r.reviewer_notes) : null,
      transcript: await getTranscript(id).catch(() => []),
    }
  }))

  return Response.json({ deliberations })
}
