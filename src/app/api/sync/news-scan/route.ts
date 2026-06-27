// Cron: pull RSS news, convert ticker-tagged items to low-confidence opportunities.
// Confidence is hardcoded below the LLM-context gate so these never enter
// predictive reasoning.

import { fetchAllRSSFeeds } from "@/lib/data/rss"
import { ingestNewsItems } from "@/lib/learning/news-to-opportunities"

export const maxDuration = 60

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const items = await fetchAllRSSFeeds().catch(() => [])
  if (items.length === 0) {
    return Response.json({ ok: true, ingested: 0, skipped: 0, items: 0, note: "no RSS items returned" })
  }

  const result = await ingestNewsItems(items)
  return Response.json({
    ok: true,
    items: items.length,
    ...result,
    ts: Date.now(),
  })
}
