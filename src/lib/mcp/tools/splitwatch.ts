// Splitwatch-sourced MCP tools.
//
// Reads from the unified opportunities table, filtered to source='splitwatch'.
// The splitwatch repo pushes rows via POST /api/opportunities/ingest (see
// .jarvis-memory/phases/phase-2-onboarding.md for the cross-repo PR guide).
//
// A proxy tool (splitwatch.get_filing) that hits splitwatch directly will
// land once that repo is deployed and we add its host to the sandbox
// whitelist.

import { z, registerTool } from "@/lib/mcp/server"
import { listOpportunities, type OpportunityStatus } from "@/lib/opportunities/store"

registerTool({
  name: "splitwatch.list_opportunities",
  description: "List recent opportunities pushed by splitwatch (reverse-split rounding-up arbitrage candidates). Filter by status; defaults to 'open' setups only.",
  inputSchema: z.object({
    status: z.enum(["open", "claimed", "executed", "expired", "rejected", "muted"]).default("open"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  requiredScope: "read:opportunities",
  handler: async (input: { status: OpportunityStatus; limit: number }) => {
    return listOpportunities({ source: "splitwatch", status: input.status, limit: input.limit })
  },
})
