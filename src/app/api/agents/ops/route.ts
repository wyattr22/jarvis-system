// Ops agent trigger (13.1). Daily post-close cron; also pingable.
// GET without auth returns the latest stored report (for dashboards).

import { db } from "@/lib/db/client"
import { runOpsAgent } from "@/lib/agents/ops"

export const maxDuration = 60

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return Response.json(await runOpsAgent())
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: Request) {
  // Cron services often GET; honor auth'd GETs as a run trigger.
  if (req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`) {
    try {
      return Response.json(await runOpsAgent())
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }
  try {
    const r = await db.execute({
      sql: "SELECT date, status, checks_json, created_at FROM ops_reports ORDER BY created_at DESC LIMIT 7",
      args: [],
    })
    return Response.json({
      reports: r.rows.map(row => ({
        date: String(row.date),
        status: String(row.status),
        checks: JSON.parse(String(row.checks_json)),
        created_at: Number(row.created_at),
      })),
    })
  } catch {
    return Response.json({ reports: [] })
  }
}
