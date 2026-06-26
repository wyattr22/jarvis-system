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
