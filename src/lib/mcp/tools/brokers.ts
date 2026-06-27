// Broker-related MCP tools.
// Lets MCP clients enumerate configured brokers and check market hours.

import { z, registerTool } from "@/lib/mcp/server"
import { listAdapters, getAdapter, type AssetClass } from "@/lib/brokers"

registerTool({
  name: "brokers.list",
  description: "List broker adapters configured in Jarvis. Returns the asset class each handles plus a human-readable name.",
  inputSchema: z.object({}),
  requiredScope: "read:account",
  handler: async () => listAdapters(),
})

registerTool({
  name: "brokers.is_open",
  description: "Check whether the market is open for a given asset class (e.g. equity hours are 9:30am-4pm ET on weekdays).",
  inputSchema: z.object({
    asset_class: z.enum(["equity", "futures", "forex", "crypto", "options", "prediction"]),
  }),
  requiredScope: "read:account",
  handler: async (input: { asset_class: AssetClass }) => {
    try {
      const adapter = getAdapter(input.asset_class)
      return { adapter: adapter.id, asset_class: input.asset_class, is_open: await adapter.isOpen() }
    } catch (err) {
      return { adapter: null, asset_class: input.asset_class, is_open: false, error: String(err) }
    }
  },
})
