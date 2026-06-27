// POST /api/allocator/run — produces the ranked allocation plan WITHOUT executing.
//
// Reads:
//   - all open opportunities
//   - current positions (live, via AlpacaAdapter; falls back to empty if down)
//   - current account equity (live; or risk_config.equity_override)
//   - current risk_config
// Returns the AllocatorPlan.
//
// Auth: none (read-only plan generation, no execution). Parity with
// /api/opportunities + /api/account-style endpoints. The /execute endpoint
// stays strictly authenticated.

import { getRiskConfig } from "@/lib/allocator/risk-config"
import { buildPlan } from "@/lib/allocator/scorer"
import { listOpportunities } from "@/lib/opportunities/store"
import { getAdapter } from "@/lib/brokers"

export const maxDuration = 30

export async function POST() {
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
