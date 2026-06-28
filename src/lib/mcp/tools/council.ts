// Council MCP tools.
//
// council.run     — triggers a full council cycle (Observer → Researcher →
//                   Critics → Risk Manager → Walk-forward). Requires
//                   execute:trades (since it can propose strategy changes).
// council.recent  — list recent council decisions from proposals table.

import { z, registerTool } from "@/lib/mcp/server"
import { safeFetch } from "@/lib/sandbox/whitelist"
import { db } from "@/lib/db/client"

registerTool({
  name: "council.run",
  description: "Trigger a full council orchestration cycle for a strategy. Runs Observer → Researcher → Critics → Risk Manager → walk-forward validation. Lands a proposal in the proposals table when complete. Returns the orchestrator's verdict.",
  inputSchema: z.object({
    strategy_id: z.string().default("smc-ict-v4"),
  }),
  requiredScope: "execute:trades",
  handler: async (input: { strategy_id: string }) => {
    // Reuse the existing /api/council/orchestrate route so all the audit +
    // proposal writing logic stays in one place.
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://jarvis-system-flame.vercel.app"
    const r = await safeFetch(`${base}/api/council/orchestrate?strategyId=${encodeURIComponent(input.strategy_id)}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${process.env.CRON_SECRET ?? ""}` },
      signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) {
      return { ok: false, status: r.status, error: await r.text().catch(() => "") }
    }
    return await r.json()
  },
})

registerTool({
  name: "council.recent",
  description: "List recent council proposals with status, ensemble confidence, risk verdict, and decided_at timestamp.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).default(10),
    status: z.enum(["pending", "approved", "shadow", "rejected"]).optional(),
  }),
  requiredScope: "read:account",
  handler: async (input: { limit: number; status?: string }) => {
    const r = input.status
      ? await db.execute({
          sql: `SELECT id, strategy_id, hypothesis, ensemble_confidence, risk_verdict, status, created_at, decided_at
                FROM proposals WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
          args: [input.status, input.limit],
        })
      : await db.execute({
          sql: `SELECT id, strategy_id, hypothesis, ensemble_confidence, risk_verdict, status, created_at, decided_at
                FROM proposals ORDER BY created_at DESC LIMIT ?`,
          args: [input.limit],
        })
    return r.rows.map(row => row as unknown as Record<string, unknown>)
  },
})
