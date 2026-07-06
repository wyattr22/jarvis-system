// Internal signal sweep trigger (12.4). Cron-auth; designed as the primary
// target for an external pinger (cron-job.org every 5-15 min during market
// hours) since Vercel Hobby crons are daily-only. Daily Vercel cron acts as
// the fallback heartbeat.

import { runSignalSweep } from "@/lib/signals/engine"

export const maxDuration = 300

async function handle(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await runSignalSweep()
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) { return handle(req) }
export async function GET(req: Request) { return handle(req) }
