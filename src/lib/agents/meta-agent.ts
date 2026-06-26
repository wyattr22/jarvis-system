import { db } from "@/lib/db/client"
import { route } from "@/lib/llm/router"
import { parseAndValidate, MetaDecisionOutputSchema, type MetaDecisionOutput } from "./schema"
import { auditLog } from "@/lib/guardrails/audit"

const MIN_SCORED_OUTPUTS = 50

export async function runMetaAgent(): Promise<{ skipped?: boolean; reason?: string; decisions?: number }> {
  const countRes = await db.execute({ sql: "SELECT COUNT(*) as n FROM agent_scores", args: [] })
  const totalScored = Number(countRes.rows[0]?.n ?? 0)

  if (totalScored < MIN_SCORED_OUTPUTS) {
    return { skipped: true, reason: `insufficient_data: ${totalScored}/${MIN_SCORED_OUTPUTS} scored outputs` }
  }

  // Per-agent accuracy + error type breakdown
  const agentStats = await db.execute({
    sql: `SELECT
            a.id, a.name, a.role,
            COUNT(s.output_id) as n_outcomes,
            SUM(s.type_1_error) as type1,
            SUM(s.type_2_error) as type2,
            AVG(CASE WHEN s.outcome = 'correct' THEN 1.0 ELSE 0.0 END) as accuracy
          FROM agents a
          LEFT JOIN agent_outputs o ON o.agent_id = a.id
          LEFT JOIN agent_scores s ON s.output_id = o.id AND s.agent_id = a.id
          GROUP BY a.id, a.name, a.role
          HAVING n_outcomes > 0`,
    args: [],
  })

  if (!agentStats.rows.length) {
    return { skipped: true, reason: "no_agent_scores" }
  }

  // 30d vs 90d accuracy trend
  const now = Date.now()
  const [recent30, baseline90] = await Promise.all([
    db.execute({
      sql: `SELECT s.agent_id, AVG(CASE WHEN s.outcome = 'correct' THEN 1.0 ELSE 0.0 END) as acc
            FROM agent_scores s JOIN agent_outputs o ON o.id = s.output_id
            WHERE o.created_at > ? GROUP BY s.agent_id`,
      args: [now - 30 * 86400000],
    }),
    db.execute({
      sql: `SELECT s.agent_id, AVG(CASE WHEN s.outcome = 'correct' THEN 1.0 ELSE 0.0 END) as acc
            FROM agent_scores s JOIN agent_outputs o ON o.id = s.output_id
            WHERE o.created_at > ? AND o.created_at <= ? GROUP BY s.agent_id`,
      args: [now - 90 * 86400000, now - 30 * 86400000],
    }),
  ])

  const acc30Map: Record<string, number> = {}
  const acc90Map: Record<string, number> = {}
  for (const r of recent30.rows) acc30Map[String(r.agent_id)] = Number(r.acc)
  for (const r of baseline90.rows) acc90Map[String(r.agent_id)] = Number(r.acc)

  const perfSummary = agentStats.rows.map(r => {
    const id = String(r.id)
    const accuracy = Number(r.accuracy ?? 0)
    const n = Number(r.n_outcomes)
    const acc30 = acc30Map[id] ?? accuracy
    const acc90 = acc90Map[id] ?? accuracy
    return {
      id,
      name: String(r.name),
      role: String(r.role),
      n_outcomes: n,
      accuracy,
      acc_30d: acc30,
      acc_90d_baseline: acc90,
      trend_degrading: acc30 < acc90 - 0.2,
      type_1_errors: Number(r.type1 ?? 0),
      type_2_errors: Number(r.type2 ?? 0),
      reward_hack_risk: accuracy < 0.5 && n > 20,
    }
  })

  const userPrompt = `You are the Meta-Agent for a self-optimizing algorithmic trading system. Your job is to evaluate agent performance and make targeted decisions.

AGENT PERFORMANCE DATA:
${JSON.stringify(perfSummary, null, 2)}

DECISION RULES:
- "update_prompt": when acc_30d drops >20% below acc_90d_baseline (trend_degrading=true)
- "adjust_weight": when accuracy <0.4 AND n_outcomes > 20 — reduce the agent's influence
- "kill_agent": ONLY if accuracy <0.3 AND reward_hack_risk=true AND n_outcomes > 50
- "spawn_agent": if there's a clear capability gap in the council

Only output decisions that are clearly warranted. When in doubt, do NOT act.

Output ONLY valid JSON:
{
  "decisions": [
    {
      "decision_type": "update_prompt"|"adjust_weight"|"spawn_agent"|"kill_agent",
      "target_agent_id": string,
      "rationale": string (minimum 30 chars),
      "proposed_change": { "action": string, "details": string },
      "evidence": { "n_outcomes": number, "accuracy": number, "type_1_errors": number, "type_2_errors": number }
    }
  ]
}`

  let output: MetaDecisionOutput | null = null
  try {
    const raw = await route({
      messages: [{ role: "user", content: userPrompt }],
      preferredModel: "groq-llama-70b",
      cacheable: false,
    })
    output = parseAndValidate(MetaDecisionOutputSchema, raw)
  } catch (e) {
    await auditLog("meta-agent", "meta_agent_parse_failed", { error: String(e) })
    return { skipped: true, reason: String(e) }
  }

  if (!output?.decisions?.length) {
    await auditLog("meta-agent", "meta_agent_no_decisions", {})
    return { decisions: 0 }
  }

  for (const d of output.decisions) {
    await db.execute({
      sql: `INSERT INTO meta_decisions
              (id, decision_type, target_agent_id, rationale, proposed_change_json, evidence_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `meta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        d.decision_type,
        d.target_agent_id,
        d.rationale,
        JSON.stringify(d.proposed_change),
        JSON.stringify(d.evidence),
        Date.now(),
      ],
    })
  }

  await auditLog("meta-agent", "meta_decisions_written", { count: output.decisions.length })
  return { decisions: output.decisions.length }
}
