// PATCH /api/opportunities/[id] — update an opportunity's status.
// Used by the dashboard Approve/Reject/Mute buttons.
//
// No bearer auth (dashboard-internal endpoint). Allowed status transitions:
//   open → claimed, rejected, muted, expired
//   claimed → executed, rejected, muted
// Any other transition is silently allowed for now — strictness lands when
// the allocator (Phase 4) needs the lifecycle locked down.

import { z } from "zod"
import { updateOpportunityStatus } from "@/lib/opportunities/store"
import { auditLog } from "@/lib/guardrails/audit"

const PatchSchema = z.object({
  status: z.enum(["open", "claimed", "executed", "expired", "rejected", "muted"]),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return Response.json({ error: "id required" }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "invalid input", details: parsed.error.message }, { status: 400 })
  }

  await updateOpportunityStatus(id, parsed.data.status)
  await auditLog("opportunities", "status_change", { id, new_status: parsed.data.status })
  return Response.json({ ok: true, id, status: parsed.data.status })
}
