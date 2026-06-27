// POST /api/allocator/execute — submits orders for the opportunities the
// caller has approved (by id). For each id we re-run sizing against the
// current plan to ensure caps are still respected at execution time, then
// dispatch through the right BrokerAdapter.
//
// Auth: CRON_SECRET only. This is the dangerous endpoint — never expose to
// dashboard-internal traffic without an explicit user approval gate.
//
// Idempotency: a `client_order_id` derived from the opportunity id keeps the
// broker from accepting two orders for the same opp.

import { z } from "zod"
import { getRiskConfig } from "@/lib/allocator/risk-config"
import { buildPlan } from "@/lib/allocator/scorer"
import { listOpportunities, updateOpportunityStatus } from "@/lib/opportunities/store"
import { getAdapter } from "@/lib/brokers"
import { recordAllocation } from "@/lib/allocator/allocations"
import { auditLog } from "@/lib/guardrails/audit"
import { vetoAllocatorPlan } from "@/lib/agents/risk-manager"

export const maxDuration = 60

const InputSchema = z.object({
  approved_ids: z.array(z.string()).min(1).max(50),
  decided_by: z.enum(["user", "auto", "council"]).default("user"),
})

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
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

  // Rebuild the plan against live state — caps may have shifted since the UI
  // showed the plan. Refuse to execute any row that is no longer "approved".
  const config = await getRiskConfig()
  const opps = await listOpportunities({ status: "open", limit: 200 })

  const equityAdapter = getAdapter("equity")
  let equity = config.equity_override ?? 0
  let positions: Awaited<ReturnType<typeof equityAdapter.positions>> = []
  if (!config.equity_override) {
    try { equity = (await equityAdapter.account()).equity } catch { /* equity stays 0 */ }
  }
  try { positions = await equityAdapter.positions() } catch { /* empty */ }

  const plan = buildPlan(opps, positions, equity, config)

  // Risk Manager veto on the whole plan + per-opportunity
  let todayPnl = 0
  try {
    const acct = await equityAdapter.account()
    todayPnl = acct.day_pnl
  } catch { /* default 0 */ }
  const veto = vetoAllocatorPlan(plan, config, todayPnl)
  if (veto.verdict === "veto") {
    await auditLog("allocator", "plan_vetoed", { reason: veto.reason, warnings: veto.warnings })
    return Response.json({
      ok: false,
      vetoed: true,
      reason: veto.reason,
      warnings: veto.warnings,
    }, { status: 403 })
  }

  const perOppAllow = new Map(veto.per_opportunity.map(p => [p.opportunity_id, p]))
  const approvedRowMap = new Map(
    plan.rows
      .filter(r => r.status === "approved")
      .filter(r => perOppAllow.get(r.opportunity.id)?.allow === true)
      .map(r => [r.opportunity.id, r]),
  )

  const results: Array<{
    opportunity_id: string
    ok: boolean
    order_id?: string
    broker?: string
    error?: string
    skipped?: string  // present when we refused to execute (no longer approved)
  }> = []

  for (const opp_id of parsed.data.approved_ids) {
    const row = approvedRowMap.get(opp_id)
    if (!row) {
      results.push({ opportunity_id: opp_id, ok: false, skipped: "no longer approved by live plan (risk caps shifted)" })
      continue
    }

    const opp = row.opportunity
    const sizing = row.sizing
    let adapter
    try {
      adapter = getAdapter(opp.asset_class)
    } catch (err) {
      results.push({ opportunity_id: opp_id, ok: false, error: String(err) })
      continue
    }

    const orderResult = await adapter.place({
      symbol: opp.instrument,
      side: opp.side === "long" ? "buy" : "sell",
      qty: sizing.size,
      type: "market",
      stop_price: opp.stop_hint,
      time_in_force: "day",
      client_order_id: `opp_${opp_id}`,
    })

    await recordAllocation({
      opportunity_id: opp_id,
      broker: adapter.id,
      order_id: orderResult.order_id ?? null,
      allocated_usd: sizing.dollar_amount,
      risk_per_trade_pct: sizing.risk_pct_of_equity,
      decided_by: parsed.data.decided_by,
      status: orderResult.ok ? "submitted" : "error",
      error: orderResult.error,
    })

    if (orderResult.ok) {
      await updateOpportunityStatus(opp_id, "executed")
    }

    await auditLog("allocator", orderResult.ok ? "executed" : "execute_failed", {
      opportunity_id: opp_id,
      broker: adapter.id,
      order_id: orderResult.order_id ?? null,
      error: orderResult.error,
      decided_by: parsed.data.decided_by,
    })

    results.push({
      opportunity_id: opp_id,
      ok: orderResult.ok,
      broker: adapter.id,
      order_id: orderResult.order_id,
      error: orderResult.error,
    })
  }

  return Response.json({
    ok: true,
    requested: parsed.data.approved_ids.length,
    executed: results.filter(r => r.ok).length,
    skipped: results.filter(r => r.skipped).length,
    errored: results.filter(r => !r.ok && !r.skipped).length,
    results,
  })
}
