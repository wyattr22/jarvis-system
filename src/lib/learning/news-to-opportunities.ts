// Pipeline: news RSS items with ticker mentions → low-confidence
// opportunities flagged as `source: 'news'`.
//
// **Important:** confidence is hardcoded to 0.2 so these never enter the
// LLM/predictive model context (the 0.5 floor strips them out). They show
// up in /opportunities for visibility only — the user can promote one
// manually by changing its status or feeding it through a real analyst.

import { ingestOpportunity } from "@/lib/opportunities/store"
import type { RSSItem } from "@/lib/data/rss"

export const NEWS_CONFIDENCE_FLOOR = 0.2  // intentionally below the 0.5 model gate

export async function ingestNewsItems(items: RSSItem[]): Promise<{
  ingested: number
  skipped: number
}> {
  let ingested = 0
  let skipped = 0
  for (const item of items) {
    // Only items that already have ticker mentions extracted
    const tickers = item.symbols ?? []
    if (tickers.length === 0) { skipped++; continue }

    for (const t of tickers.slice(0, 3)) {  // cap at 3 per item to avoid spam
      try {
        await ingestOpportunity({
          source: "news",
          asset_class: "equity",
          instrument: t,
          side: "long",  // we don't know direction from a headline; assume long for inventory
          thesis: `${item.source}: ${item.title.slice(0, 240)}`,
          confidence: NEWS_CONFIDENCE_FLOOR,
          expires_at: Date.now() + 24 * 60 * 60 * 1000,  // 24h shelf life
          source_payload: {
            link: item.link,
            pubDate: item.pubDate,
            news_source: item.source,
          },
        })
        ingested++
      } catch {
        skipped++
      }
    }
  }
  return { ingested, skipped }
}
