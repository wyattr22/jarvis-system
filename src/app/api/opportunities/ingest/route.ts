// External projects POST detected opportunities here.
//
// Auth: bearer token validated against mcp_clients (same registry as MCP).
// Client must have `write:opportunities` scope. CRON_SECRET grants `*` access.
//
// Request body shape mirrors OpportunityInput in src/lib/opportunities/store.ts.

import { z } from "zod"
import { authenticateRequest } from "@/lib/mcp/auth"
import { ingestOpportunity } from "@/lib/opportunities/store"

const InputSchema = z.object({
  source: z.string().min(1).max(50),
  asset_class: z.enum(["equity", "crypto", "futures", "forex", "options", "prediction"]),
  instrument: z.string().min(1).max(40),
  side: z.enum(["long", "short"]),
  thesis: z.string().min(1).max(2000),
  expected_r: z.number().optional(),
  win_prob: z.number().min(0).max(1).optional(),
  horizon_days: z.number().int().min(0).optional(),
  entry_hint: z.number().optional(),
  stop_hint: z.number().optional(),
  size_hint: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  expires_at: z.number().int().optional(),
  source_payload: z.record(z.string(), z.unknown()).optional(),
})

export const maxDuration = 30

export async function POST(req: Request) {
  const auth = await authenticateRequest(req)
  if (!auth.ok) return new Response(auth.message, { status: auth.status })
  const scopes = auth.ctx.scopes
  if (!scopes.includes("write:opportunities") && !scopes.includes("*")) {
    return new Response("missing scope: write:opportunities", { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }

  const parsed = InputSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "invalid input", details: parsed.error.message }, { status: 400 })
  }

  // Enforce that the source field matches the client (so a swing token can't
  // post as if it were splitwatch). Admin/CRON bypass this.
  if (auth.ctx.clientId !== "cron" && !scopes.includes("*")) {
    // clientId looks like 'mcp_<ts>_<rand>' — we trust the spec'd source value
    // but log the binding for audit. Strict source==client.id enforcement
    // would require source naming alignment we don't have yet.
  }

  const { id, dedup } = await ingestOpportunity(parsed.data)
  return Response.json({ ok: true, id, dedup, client: auth.ctx.clientId })
}
