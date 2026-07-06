// Time-stop monitor cron. Pulls live positions, joins back to opportunities
// via allocations, alerts on positions held past horizon_days.

import { getAdapter } from "@/lib/brokers"
import { computeTimeStops } from "@/lib/learning/time-stop-monitor"
import { auditLog } from "@/lib/guardrails/audit"
import { sendPushToAll } from "@/lib/push"

export const maxDuration = 30

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const equityAdapter = getAdapter("equity")
  let positions: Awaited<ReturnType<typeof equityAdapter.positions>> = []
  try {
    positions = await equityAdapter.positions()
  } catch (err) {
    return Response.json({ ok: false, error: `positions fetch failed: ${err}` }, { status: 503 })
  }

  const alerts = await computeTimeStops(positions)

  for (const a of alerts) {
    await auditLog("time-stop-monitor", "time_stop_breached", a).catch(() => {})
    // Push notification — these are not as urgent as drawdown danger, but the
    // user should know a position is past its intended horizon.
    await sendPushToAll({
      title: `⌛ ${a.symbol} past time stop (${a.days_held}d > ${a.horizon_days}d)`,
      body: `From ${a.source}: ${a.thesis.slice(0, 80)} — unrealized $${a.current_unrealized_pl.toFixed(0)}`,
      tag: `ts-${a.symbol}`,
      url: "/portfolio",
    }).catch(() => {})
  }

  return Response.json({
    ok: true,
    positions_count: positions.length,
    alerts,
    ts: Date.now(),
  })
}
