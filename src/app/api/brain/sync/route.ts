// Knowledge-graph structural sync (Phase 21). Cron-auth, same pattern as
// every other scheduled job in this repo. Daily is plenty for a
// non-latency-sensitive sync -- fits the Vercel Hobby daily-only cron
// constraint (KNOWN_ISSUES.md) without needing an external pinger.

import { runStructuralSync } from "@/lib/knowledge-graph/store"

async function handle(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await runStructuralSync()
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) { return handle(req) }
export async function GET(req: Request) { return handle(req) }
