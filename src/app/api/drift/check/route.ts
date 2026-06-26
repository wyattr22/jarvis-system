import { db } from "@/lib/db/client"
import { checkDrift, type DriftCheckResult } from "@/lib/guardrails/drift"
import { sendPushToAll } from "@/lib/push"

function checkAuth(req: Request): boolean {
  return req.headers.get("x-vercel-cron") === "1" ||
    req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return Response.json({ error: "Unauthorized" }, { status: 401 })
  return runDrift()
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return Response.json({ error: "Unauthorized" }, { status: 401 })
  return runDrift()
}

async function runDrift() {
  const strategies = await db.execute("SELECT id FROM strategies WHERE enabled = 1")
  const results = await Promise.allSettled(strategies.rows.map(r => checkDrift(r.id as string)))

  // Notify on auto-pause events
  const paused: string[] = []
  for (const r of results) {
    if (r.status === "fulfilled" && (r.value as DriftCheckResult).autoPaused) {
      paused.push((r.value as DriftCheckResult).strategyId)
    }
  }

  if (paused.length) {
    await sendPushToAll({
      title: "Strategy Auto-Paused",
      body: `Drift kill switch triggered: ${paused.join(", ")}. Check the Drift page.`,
      tag: "drift-alert",
      url: "/drift",
    })
  }

  return Response.json({
    checked: results.length,
    results: results.map(r => r.status === "fulfilled" ? r.value : { error: String(r.reason) }),
  })
}
