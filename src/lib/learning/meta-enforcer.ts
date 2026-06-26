// Reads pending meta_decisions and applies the safe ones automatically.
// Safe automations:
//   - update_prompt → write a new prompt_versions row, mark active
//   - adjust_weight → update an agent_weights table the Critics consult
// Risky decisions (kill_agent, spawn_agent) are recorded but require user
// approval via the UI — never auto-executed.

import { db } from "@/lib/db/client"
import { auditLog } from "@/lib/guardrails/audit"

let weightsTableReady = false
async function ensureWeightsTable(): Promise<void> {
  if (weightsTableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS agent_weights (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id),
      weight REAL NOT NULL DEFAULT 1.0,
      updated_at INTEGER NOT NULL,
      reason TEXT
    )
  `)
  weightsTableReady = true
}

async function nextVersion(agentId: string): Promise<number> {
  const r = await db.execute({
    sql: `SELECT COALESCE(MAX(version), 0) + 1 AS next_v FROM prompt_versions WHERE agent_id = ?`,
    args: [agentId],
  })
  return Number((r.rows[0] as any)?.next_v ?? 1)
}

async function applyPromptUpdate(decision: {
  id: string
  target_agent_id: string
  rationale: string
  proposed_change: any
}): Promise<{ applied: boolean; reason?: string }> {
  const newPrompt = decision.proposed_change?.new_prompt
    ?? decision.proposed_change?.prompt_text
    ?? decision.proposed_change?.prompt
  if (!newPrompt || typeof newPrompt !== "string" || newPrompt.length < 20) {
    return { applied: false, reason: "no_prompt_provided" }
  }

  const now = Date.now()
  const version = await nextVersion(decision.target_agent_id)

  // Close out previously active prompt
  await db.execute({
    sql: `UPDATE prompt_versions SET active_to = ? WHERE agent_id = ? AND active_to IS NULL`,
    args: [now, decision.target_agent_id],
  })
  // Insert new active version
  await db.execute({
    sql: `INSERT INTO prompt_versions (agent_id, version, prompt_text, changed_by, active_from, active_to)
          VALUES (?, ?, ?, 'meta-agent', ?, NULL)`,
    args: [decision.target_agent_id, version, newPrompt, now],
  })
  // Mirror into the agents table so simple readers see the latest
  await db.execute({
    sql: `UPDATE agents SET system_prompt = ? WHERE id = ?`,
    args: [newPrompt, decision.target_agent_id],
  })
  await auditLog("meta-enforcer", "prompt_updated", {
    decision_id: decision.id,
    agent_id: decision.target_agent_id,
    version,
    rationale: decision.rationale,
  })
  return { applied: true }
}

async function applyWeightAdjust(decision: {
  id: string
  target_agent_id: string
  rationale: string
  proposed_change: any
}): Promise<{ applied: boolean; reason?: string }> {
  await ensureWeightsTable()
  const w = Number(decision.proposed_change?.weight ?? decision.proposed_change?.new_weight)
  if (!Number.isFinite(w) || w < 0 || w > 2) {
    return { applied: false, reason: `weight_out_of_range: ${w}` }
  }
  const now = Date.now()
  await db.execute({
    sql: `INSERT INTO agent_weights (agent_id, weight, updated_at, reason) VALUES (?,?,?,?)
          ON CONFLICT(agent_id) DO UPDATE SET weight=?, updated_at=?, reason=?`,
    args: [decision.target_agent_id, w, now, decision.rationale, w, now, decision.rationale],
  })
  await auditLog("meta-enforcer", "weight_adjusted", {
    decision_id: decision.id,
    agent_id: decision.target_agent_id,
    weight: w,
  })
  return { applied: true }
}

export async function runMetaEnforcer(): Promise<{
  considered: number
  applied: number
  needsApproval: number
  errors: number
}> {
  const due = await db.execute({
    sql: `SELECT id, decision_type, target_agent_id, rationale, proposed_change_json
          FROM meta_decisions
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 50`,
    args: [],
  })

  let applied = 0
  let needsApproval = 0
  let errors = 0

  for (const row of due.rows) {
    const r = row as any
    const decision = {
      id: String(r.id),
      decision_type: String(r.decision_type),
      target_agent_id: r.target_agent_id ? String(r.target_agent_id) : "",
      rationale: r.rationale ? String(r.rationale) : "",
      proposed_change: r.proposed_change_json ? JSON.parse(String(r.proposed_change_json)) : {},
    }

    if (!decision.target_agent_id) {
      errors++
      continue
    }

    try {
      if (decision.decision_type === "update_prompt") {
        const res = await applyPromptUpdate(decision)
        if (res.applied) {
          applied++
          await db.execute({
            sql: `UPDATE meta_decisions SET status='applied', decided_at=? WHERE id=?`,
            args: [Date.now(), decision.id],
          })
        } else { errors++ }
      } else if (decision.decision_type === "adjust_weight") {
        const res = await applyWeightAdjust(decision)
        if (res.applied) {
          applied++
          await db.execute({
            sql: `UPDATE meta_decisions SET status='applied', decided_at=? WHERE id=?`,
            args: [Date.now(), decision.id],
          })
        } else { errors++ }
      } else if (decision.decision_type === "kill_agent" || decision.decision_type === "spawn_agent") {
        // Never auto-execute. Mark as needs_approval — surfaced in UI for manual decision.
        needsApproval++
        await db.execute({
          sql: `UPDATE meta_decisions SET status='needs_approval' WHERE id=?`,
          args: [decision.id],
        })
      } else {
        errors++
      }
    } catch (err) {
      errors++
      await auditLog("meta-enforcer", "apply_failed", {
        decision_id: decision.id,
        error: String(err).slice(0, 500),
      })
    }
  }

  return { considered: due.rows.length, applied, needsApproval, errors }
}
