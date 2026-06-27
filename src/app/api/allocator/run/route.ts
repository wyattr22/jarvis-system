// POST /api/allocator/run — produces the ranked allocation plan WITHOUT executing.
//
// Reads:
//   - all open opportunities
//   - current positions (live, via AlpacaAdapter; falls back to empty if down)
//   - current account equity (live; or risk_config.equity_override)
//   - current risk_config
// Returns the AllocatorPlan.
//
// Auth: CRON_SECRET (for now). The UI in 4.5 will call this from the dashboard
// and pass the secret through (or we lift the auth check for dashboard-internal).

import { getRiskConfig } from "@/lib/allocator/risk-config"
import { buildPlan } from "@/lib/allocator/scorer"
import { listOpportunities } from "@/lib/opportunities/store"
import { getAdapter } from "@/lib/brokers"

export const maxDuration = 30

function authed(req: Request): boolean {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
}

export async function POST(req: Request) {
  if (!authed(req)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const config = await getRiskConfig()
  const opps = await listOpportunities({ status: "open", limit: 200 })

  const equityAdapter = getAdapter("equity")
  let equity = config.equity_override ?? 0
  let positions: Awaited<ReturnType<typeof equityAdapter.positions>> = []
  if (!config.equity_override) {
    try {
      const acct = await equityAdapter.account()
      equity = acct.equity
    } catch {
      // Adapter down — return a plan with equity=0 so all opps fail "non-positive equity"
      // and surface the issue.
    }
  }
  try {
    positions = await equityAdapter.positions()
  } catch {
    /* empty list is fine */
  }

  const plan = buildPlan(opps, positions, equity, config)
  return Response.json({
    ok: true,
    generated_at: Date.now(),
    plan,
  })
}
