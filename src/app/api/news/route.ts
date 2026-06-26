import { getAlpacaNews } from "@/lib/data/alpaca"
import { fetchAllRSSFeeds, fetchTickerRSS } from "@/lib/data/rss"

const MARKET_SYMBOLS = [
  "SPY", "QQQ", "IWM", "DIA",
  "TSLA", "NVDA", "AAPL", "MSFT", "META", "GOOGL",
  "RIOT", "MARA", "HUT", "CLSK",
  "IONQ", "HOOD", "SNAP", "RCAT",
]

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const symbolParam = searchParams.get("symbols")
  const symbols = symbolParam ? symbolParam.split(",") : MARKET_SYMBOLS
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100)
  const rssOnly = searchParams.get("rss") === "1"

  try {
    // Run Alpaca news and RSS in parallel
    const [alpacaRaw, rssItems, tickerRss] = await Promise.all([
      rssOnly ? Promise.resolve([]) : getAlpacaNews(symbols, limit).catch(() => []),
      fetchAllRSSFeeds(),
      symbolParam ? fetchTickerRSS(symbols[0]) : Promise.resolve([]),
    ])

    // Normalize Alpaca articles
    type AlpacaArticle = {
      id: number
      headline: string
      summary: string
      author: string
      created_at: string
      url: string
      symbols: string[]
      source: string
    }
    const alpacaNorm = (alpacaRaw as AlpacaArticle[]).map(a => ({
      id: String(a.id),
      headline: a.headline,
      summary: a.summary || '',
      url: a.url,
      source: a.source || 'Benzinga',
      publishedAt: a.created_at,
      symbols: a.symbols ?? [],
    }))

    // Normalize RSS articles
    const rssNorm = [...rssItems, ...tickerRss].map((item, i) => ({
      id: `rss-${i}-${item.source}`,
      headline: item.title,
      summary: item.description,
      url: item.link,
      source: item.source,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      symbols: item.symbols,
    }))

    // Merge, deduplicate by headline, sort newest first
    const all = [...alpacaNorm, ...rssNorm]
    const seen = new Set<string>()
    const deduped = all
      .filter(a => {
        const key = a.headline.toLowerCase().replace(/\W+/g, '')
        if (seen.has(key)) return false
        seen.add(key)
        return a.headline.length > 10
      })
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 150)

    return Response.json({ news: deduped, sources: deduped.length })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 })
  }
}
