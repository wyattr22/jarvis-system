// Generic opportunities MCP tools (vs source-specific like splitwatch/swing).
//
// Useful when a client wants to reason across sources, or update status without
// going through the dashboard PATCH endpoint.

import { z, registerTool } from "@/lib/mcp/server"
import {
  listOpportunities, updateOpportunityStatus, ingestOpportunity,
  type OpportunityStatus, type AssetClass,
} from "@/lib/opportunities/store"
import { getOpportunitiesForCouncil } from "@/lib/agents/opportunities-context"
import { auditLog } from "@/lib/guardrails/audit"

registerTool({
  name: "opportunities.list",
  description: "List opportunities across all sources with optional filters. Returns the full row shape including thesis, expected_r, win_prob, confidence, and current status.",
  inputSchema: z.object({
    source: z.string().optional(),
    status: z.enum(["open", "claimed", "executed", "expired", "rejected", "muted"]).optional(),
    asset_class: z.enum(["equity", "crypto", "futures", "forex", "options", "prediction"]).optional(),
    instrument: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  requiredScope: "read:opportunities",
  handler: async (input: {
    source?: string
    status?: OpportunityStatus
    asset_class?: AssetClass
    instrument?: string
    limit: number
  }) => {
    return await listOpportunities(input)
  },
})

registerTool({
  name: "opportunities.top",
  description: "Get the top opportunities ranked by score (expected_r × win_prob × confidence). Filters out anything below 0.5 confidence. Useful for 'what's the best opportunity right now' questions.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).default(5),
  }),
  requiredScope: "read:opportunities",
  handler: async (input: { limit: number }) => {
    const ctx = await getOpportunitiesForCouncil()
    return {
      total_open: ctx.total_open,
      by_source: ctx.by_source,
      by_asset_class: ctx.by_asset_class,
      top: ctx.top.slice(0, input.limit),
    }
  },
})

registerTool({
  name: "opportunities.update_status",
  description: "Change an opportunity's status. Used to approve/reject/mute/reopen from a chat client without going through the dashboard. Writes an audit_log entry.",
  inputSchema: z.object({
    id: z.string(),
    status: z.enum(["open", "claimed", "executed", "expired", "rejected", "muted"]),
  }),
  requiredScope: "write:opportunities",
  handler: async (input: { id: string; status: OpportunityStatus }) => {
    await updateOpportunityStatus(input.id, input.status)
    await auditLog("opportunities.mcp", "status_change", { id: input.id, new_status: input.status })
    return { ok: true, id: input.id, status: input.status }
  },
})

registerTool({
  name: "opportunities.ingest",
  description: "Push a new opportunity into the unified feed. Dedup applies (same source+instrument+side within 24h refreshes the existing row).",
  inputSchema: z.object({
    source: z.string(),
    asset_class: z.enum(["equity", "crypto", "futures", "forex", "options", "prediction"]),
    instrument: z.string(),
    side: z.enum(["long", "short"]),
    thesis: z.string(),
    expected_r: z.number().optional(),
    win_prob: z.number().min(0).max(1).optional(),
    horizon_days: z.number().int().min(0).optional(),
    entry_hint: z.number().optional(),
    stop_hint: z.number().optional(),
    size_hint: z.number().optional(),
    confidence: z.number().min(0).max(1).optional(),
    expires_at: z.number().int().optional(),
  }),
  requiredScope: "write:opportunities",
  handler: async (input: Parameters<typeof ingestOpportunity>[0]) => {
    return await ingestOpportunity(input)
  },
})
