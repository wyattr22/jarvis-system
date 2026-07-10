// Council deliberation transcript (12.9).
// The orchestrator records every agent's output as an agent_outputs row so
// "how the council thinks" is a queryable per-proposal timeline instead of
// being buried in proposals.*_json blobs.

import { db } from "@/lib/db/client"

/** Best-effort agent_id lookup by role; null keeps the row insertable. */
async function agentIdFor(role: string): Promise<string | null> {
  try {
    const r = await db.execute({
      sql: "SELECT id FROM agents WHERE role = ? OR name LIKE ? LIMIT 1",
      args: [role, `%${role}%`],
    })
    return r.rows[0] ? String(r.rows[0].id) : null
  } catch {
    return null
  }
}

export async function recordAgentOutput(
  role: string,
  outputType: string,
  output: unknown,
  relatedId: string | null,
): Promise<void> {
  try {
    const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.execute({
      sql: `INSERT INTO agent_outputs (id, agent_id, output_type, output_json, related_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, await agentIdFor(role), outputType, JSON.stringify({ role, ...((output ?? {}) as object) }), relatedId, Date.now()],
    })
  } catch {
    // transcript is observability, never break the cycle for it
  }
}

export interface DeliberationStep {
  role: string
  output_type: string
  output: Record<string, unknown>
  created_at: number
}

export async function getTranscript(proposalId: string): Promise<DeliberationStep[]> {
  const r = await db.execute({
    sql: `SELECT output_type, output_json, created_at FROM agent_outputs
          WHERE related_id = ? ORDER BY created_at ASC`,
    args: [proposalId],
  })
  return r.rows.map(row => {
    let output: Record<string, unknown> = {}
    try { output = JSON.parse(String(row.output_json)) } catch { /* keep empty */ }
    return {
      role: String(output.role ?? "unknown"),
      output_type: String(row.output_type),
      output,
      created_at: Number(row.created_at),
    }
  })
}
