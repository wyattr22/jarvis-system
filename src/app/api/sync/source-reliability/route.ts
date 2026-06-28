// Daily cron: recomputes per-source reliability scores from recent trade outcomes.
// Allocator scorer can multiply each opportunity's score by its source reliability
// once this table has data.

import { recomputeSourceReliability } from "@/lib/learning/source-reliability"

export const maxDuration = 30

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const url = new URL(req.url)
  const daysBack = Math.min(365, Math.max(7, Number(url.searchParams.get("days") ?? 60)))
  const results = await recomputeSourceReliability(daysBack)
  return Response.json({ ok: true, days_back: daysBack, sources_updated: results.length, results })
}
