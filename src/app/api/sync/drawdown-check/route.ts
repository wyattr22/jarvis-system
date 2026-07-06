// Drawdown monitor cron. Pulls live positions, computes per-position drawdown,
// and writes alerts to audit_log when warn/danger thresholds are crossed.
// Future: push notifications via web-push for danger-level events.

import { getAdapter } from "@/lib/brokers"
import { computeDrawdowns } from "@/lib/learning/drawdown-monitor"
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

  const alerts = computeDrawdowns(positions)

  for (const alert of alerts) {
    await auditLog("drawdown-monitor", `drawdown_${alert.severity}`, alert).catch(() => {})
    // Push notification only on danger — warn is dashboard-visible only
    if (alert.severity === "danger") {
      await sendPushToAll({
        title: `⚠️ ${alert.symbol} drawdown ${(alert.drawdown_pct * 100).toFixed(1)}%`,
        body: `Position ${alert.symbol} qty=${alert.qty} unrealized $${alert.current_unrealized_pl.toFixed(0)}`,
        tag: `dd-${alert.symbol}`,
        url: "/portfolio",
      }).catch(() => {})
    }
  }

  return Response.json({
    ok: true,
    positions_count: positions.length,
    alerts,
    ts: Date.now(),
  })
}
