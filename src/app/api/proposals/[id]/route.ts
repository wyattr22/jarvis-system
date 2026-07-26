import { db } from "@/lib/db/client"
import { auditLog } from "@/lib/guardrails/audit"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { status, reviewerNotes } = await req.json()

  const allowed = ["approved", "rejected", "shadow"]
  if (!allowed.includes(status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 })
  }

  await db.execute({
    sql: "UPDATE proposals SET status = ?, reviewer_notes = ?, decided_at = ? WHERE id = ?",
    args: [status, reviewerNotes ?? null, Date.now(), id],
  })

  // Phase 20: approving a "new_strategy" proposal enables its draft
  // strategies row (created at capital_tier 0 by the orchestrator) so it
  // starts generating real signals/opportunities for observation --
  // capital_tier stays 0, so Phase 18's shadow-tier gate still guarantees
  // it can't reach a broker. Promotion to a trading tier is a separate,
  // later human decision, not something approving the proposal itself does.
  if (status === "approved") {
    const proposalRow = await db.execute({
      sql: "SELECT strategy_id, proposed_change_json FROM proposals WHERE id = ?",
      args: [id],
    })
    const row = proposalRow.rows[0]
    if (row) {
      try {
        const change = JSON.parse(String(row.proposed_change_json))
        if (change?.type === "new_strategy") {
          await db.execute({
            sql: "UPDATE strategies SET enabled = 1 WHERE id = ?",
            args: [row.strategy_id],
          })
          await auditLog("user", "new_strategy_enabled", { strategyId: row.strategy_id, proposalId: id })
        }
      } catch { /* malformed proposed_change_json -- nothing to enable */ }
    }
  }

  await auditLog("user", `proposal_${status}`, { proposalId: id, notes: reviewerNotes })

  return Response.json({ ok: true })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = await db.execute({
    sql: "SELECT * FROM proposals WHERE id = ?",
    args: [id],
  })
  if (result.rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }
  return Response.json(result.rows[0])
}
