// Auto-execution cycle trigger (12.8). Cron-auth. Primary target for the
// external pinger (cron-job.org, every 5-15 min during market hours);
// the daily Vercel cron is only a fallback heartbeat.
//
// Safe by default: does nothing beyond signal→opportunity promotion unless
// risk_config.auto_execute is true, and every order passes sizing caps +
// Risk-Manager veto + market-hours gate. Paper Alpaca only.

import { runAutoCycle } from "@/lib/execution/auto-cycle"

export const maxDuration = 120

async function handle(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await runAutoCycle()
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) { return handle(req) }
export async function GET(req: Request) { return handle(req) }
