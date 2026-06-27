// Swing scanner MCP tools.
//
// Same pattern as splitwatch: reads from the unified opportunities table
// filtered to source='swing'. The swing scanner project pushes setups via
// POST /api/opportunities/ingest (see phase-2-onboarding.md).

import { z, registerTool } from "@/lib/mcp/server"
import { listOpportunities, type OpportunityStatus } from "@/lib/opportunities/store"

registerTool({
  name: "swing.list_setups",
  description: "List recent swing-trade setups detected by the swing scanner (multi-day timeframe, SMC + technical structure). Filter by status; defaults to 'open' setups only.",
  inputSchema: z.object({
    status: z.enum(["open", "claimed", "executed", "expired", "rejected", "muted"]).default("open"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  requiredScope: "read:opportunities",
  handler: async (input: { status: OpportunityStatus; limit: number }) => {
    return listOpportunities({ source: "swing", status: input.status, limit: input.limit })
  },
})
