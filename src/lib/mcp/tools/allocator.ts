// Allocator MCP tools.
//
// allocator.plan        — generates the ranked plan without executing
// allocator.execute     — executes approved opportunity ids (requires execute:trades scope)
// allocator.summary     — short text summary of plan for chat clients

import { z, registerTool } from "@/lib/mcp/server"
import { getRiskConfig } from "@/lib/allocator/risk-config"
import { buildPlan } from "@/lib/allocator/scorer"
import { listOpportunities } from "@/lib/opportunities/store"
import { getAdapter } from "@/lib/brokers"
import { vetoAllocatorPlan } from "@/lib/agents/risk-manager"
import { safeFetch } from "@/lib/sandbox/whitelist"

async function fetchLivePlan() {
  const config = await getRiskConfig()
  const opps = await listOpportunities({ status: "open", limit: 200 })
  const eqAdapter = getAdapter("equity")
  let equity = config.equity_override ?? 0
  let positions: Awaited<ReturnType<typeof eqAdapter.positions>> = []
  if (!config.equity_override) {
    try { equity = (await eqAdapter.account()).equity } catch {}
  }
  try { positions = await eqAdapter.positions() } catch {}
  let todayPnl = 0
  try { todayPnl = (await eqAdapter.account()).day_pnl } catch {}
  const plan = buildPlan(opps, positions, equity, config)
  const veto = vetoAllocatorPlan(plan, config, todayPnl)
  return { config, equity, plan, veto, todayPnl }
}

registerTool({
  name: "allocator.plan",
  description: "Generate the current ranked allocation plan against live opportunities + positions + risk config. Returns the full plan + Risk Manager verdict. Does NOT execute anything.",
  inputSchema: z.object({}),
  requiredScope: "read:account",
  handler: async () => {
    const { equity, plan, veto, todayPnl } = await fetchLivePlan()
    return {
      equity,
      today_pnl: todayPnl,
      veto_verdict: veto.verdict,
      veto_reason: veto.reason,
      warnings: veto.warnings,
      plan: {
        approved_count: plan.approved_count,
        total_dollar_at_risk: plan.total_dollar_at_risk,
        rows: plan.rows.map(r => ({
          opportunity_id: r.opportunity.id,
          source: r.opportunity.source,
          instrument: r.opportunity.instrument,
          side: r.opportunity.side,
          score: r.score,
          status: r.status,
          block_reason: r.block_reason ?? r.sizing.reason,
          size: r.sizing.size,
          dollar_amount: r.sizing.dollar_amount,
          dollar_risk: r.sizing.dollar_risk,
          kelly_fraction: r.sizing.kelly_fraction,
        })),
      },
    }
  },
})

registerTool({
  name: "allocator.summary",
  description: "Short prose summary of the current allocator plan, suitable for chat responses. Highlights approved rows and risk warnings.",
  inputSchema: z.object({}),
  requiredScope: "read:account",
  handler: async () => {
    const { equity, plan, veto } = await fetchLivePlan()
    const approved = plan.rows.filter(r => r.status === "approved")
    if (veto.verdict === "veto") {
      return `Plan vetoed by Risk Manager: ${veto.reason}. ${plan.approved_count} otherwise-approved opportunities will not execute.`
    }
    if (approved.length === 0) {
      return `No approved opportunities right now. ${plan.rows.length} total candidates — all blocked by risk caps or missing data. Equity $${equity.toFixed(0)}.`
    }
    const lines = approved.map(r =>
      `${r.opportunity.source}:${r.opportunity.instrument} ${r.opportunity.side} ${r.sizing.size}sh @ $${r.opportunity.entry_hint?.toFixed(2)} (risk $${r.sizing.dollar_risk.toFixed(0)}, score ${r.score.toFixed(2)})`
    )
    const warn = veto.warnings.length ? ` Warnings: ${veto.warnings.join("; ")}.` : ""
    return `${approved.length} approved at $${equity.toFixed(0)} equity, $${plan.total_dollar_at_risk.toFixed(0)} total at risk:\n${lines.join("\n")}${warn}`
  },
})

registerTool({
  name: "allocator.execute",
  description: "Execute approved opportunity ids by submitting orders through the right broker. Requires execute:trades scope. Refuses any id that's no longer approved by the live plan.",
  inputSchema: z.object({
    approved_ids: z.array(z.string()).min(1).max(50),
  }),
  requiredScope: "execute:trades",
  handler: async (input: { approved_ids: string[] }) => {
    // Re-use the /api/allocator/execute route via safeFetch so all the
    // execution + audit + idempotency logic stays in one place.
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://jarvis-system-flame.vercel.app"
    const r = await safeFetch(`${base}/api/allocator/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.CRON_SECRET ?? ""}`,
      },
      body: JSON.stringify({ approved_ids: input.approved_ids, decided_by: "user" }),
      signal: AbortSignal.timeout(50_000),
    })
    if (!r.ok) {
      return { ok: false, status: r.status, error: await r.text().catch(() => "") }
    }
    return await r.json()
  },
})
