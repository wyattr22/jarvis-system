import { safeFetch } from "@/lib/sandbox/whitelist"

export interface RSSItem {
  title: string
  link: string
  pubDate: string
  description: string
  source: string
  symbols: string[]
}

function extractTag(xml: string, tag: string): string {
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
  if (cdataMatch) return cdataMatch[1].trim()
  const normalMatch = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return normalMatch ? normalMatch[1].replace(/<[^>]+>/g, '').trim() : ''
}

const KNOWN_TICKERS = new Set([
  'AAPL','MSFT','NVDA','GOOGL','GOOG','META','AMZN','TSLA','NFLX','AMD',
  'INTC','QCOM','AVGO','TXN','MU','AMAT','LRCX','KLAC','SNPS','CDNS',
  'JPM','BAC','GS','MS','WFC','C','V','MA','PYPL','SQ',
  'XOM','CVX','COP','OXY','SLB','HAL','BP','SHEL',
  'JNJ','PFE','ABBV','LLY','MRK','UNH','CVS','AMGN','GILD','MRNA',
  'WMT','COST','TGT','HD','LOW','NKE','SBUX','MCD',
  'SPY','QQQ','IWM','DIA','GLD','SLV','TLT','HYG',
  'RIOT','MARA','HUT','CLSK','COIN','MSTR',
  'IONQ','HOOD','SNAP','RCAT','ALAB','AAOI','CRDO',
  'LMT','RTX','NOC','BA','GD',
  'BTC','ETH',
])

// Company name → ticker so "Tesla" in a headline maps to TSLA
const COMPANY_ALIASES: Record<string, string> = {
  'tesla': 'TSLA', 'apple': 'AAPL', 'nvidia': 'NVDA', 'microsoft': 'MSFT',
  'google': 'GOOGL', 'alphabet': 'GOOGL', 'amazon': 'AMZN', 'meta ': 'META',
  'facebook': 'META', 'instagram': 'META', 'whatsapp': 'META',
  'netflix': 'NFLX', 'qualcomm': 'QCOM', 'broadcom': 'AVGO',
  'jpmorgan': 'JPM', 'jp morgan': 'JPM', 'chase': 'JPM',
  'bank of america': 'BAC', 'goldman sachs': 'GS', 'morgan stanley': 'MS',
  'wells fargo': 'WFC', 'citigroup': 'C', 'citibank': 'C', 'citi ': 'C',
  'visa ': 'V', 'mastercard': 'MA', 'paypal': 'PYPL',
  'exxon': 'XOM', 'chevron': 'CVX', 'conocophillips': 'COP',
  'pfizer': 'PFE', 'johnson & johnson': 'JNJ', 'abbvie': 'ABBV',
  'eli lilly': 'LLY', 'merck': 'MRK', 'unitedhealth': 'UNH', 'moderna': 'MRNA',
  'walmart': 'WMT', 'costco': 'COST', 'target ': 'TGT', 'home depot': 'HD',
  'nike': 'NKE', 'starbucks': 'SBUX', "mcdonald's": 'MCD', 'mcdonalds': 'MCD',
  'coinbase': 'COIN', 'robinhood': 'HOOD', 'riot ': 'RIOT', 'marathon digital': 'MARA',
  'snapchat': 'SNAP', 'lockheed': 'LMT', 'boeing': 'BA',
  'raytheon': 'RTX', 'northrop': 'NOC', 'general dynamics': 'GD',
  'bitcoin': 'BTC', 'ethereum': 'ETH', 'crypto': 'COIN',
  'intel ': 'INTC', 'amd ': 'AMD', 'advanced micro': 'AMD',
}

function extractSymbols(text: string): string[] {
  const found = new Set<string>()
  // Match ALL-CAPS tickers directly (e.g. $TSLA or bare TSLA)
  for (const m of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
    if (KNOWN_TICKERS.has(m[1])) found.add(m[1])
  }
  // Match company names case-insensitively
  const lower = text.toLowerCase()
  for (const [name, ticker] of Object.entries(COMPANY_ALIASES)) {
    if (lower.includes(name)) found.add(ticker)
  }
  return [...found].slice(0, 8)
}

function parseRSS(xml: string, sourceName: string): RSSItem[] {
  const items: RSSItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const body = match[1]
    const title = extractTag(body, 'title')
    // <link> in RSS 2.0 is often text between tags, not href attribute
    const linkMatch = body.match(/<link>([^<]+)<\/link>/i) ||
                      body.match(/<link\s+href="([^"]+)"/i)
    const link = linkMatch?.[1]?.trim() || ''
    const pubDate = extractTag(body, 'pubDate') || extractTag(body, 'dc:date') || new Date().toUTCString()
    const description = extractTag(body, 'description').replace(/&lt;[^&]*&gt;/g, '').trim()
    if (title) {
      items.push({
        title,
        link,
        pubDate,
        description: description.slice(0, 300),
        source: sourceName,
        symbols: extractSymbols(title + ' ' + description),
      })
    }
  }
  return items
}

const RSS_SOURCES: { url: string; name: string }[] = [
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', name: 'MarketWatch' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', name: 'CNBC' },
  { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters' },
  { url: 'https://www.thestreet.com/rss/main.xml', name: 'TheStreet' },
  { url: 'https://finance.yahoo.com/news/rssindex', name: 'Yahoo Finance' },
  { url: 'https://www.investing.com/rss/news_283.rss', name: 'Investing.com' },
  { url: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets', name: 'Nasdaq' },
  { url: 'https://www.fool.com/feeds/index.aspx', name: 'Motley Fool' },
  { url: 'https://www.barrons.com/xml/rss/3_7514.xml', name: 'Barrons' },
  { url: 'https://feed.businesswire.com/rss/home/?rss=G1&rssid=rss_service_news', name: 'Business Wire' },
]

async function fetchRSSFeed(url: string, name: string): Promise<RSSItem[]> {
  try {
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Jarvis/2.0 financial aggregator)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 300 },
    })
    if (!res.ok) return []
    const text = await res.text()
    return parseRSS(text, name)
  } catch {
    return []
  }
}

export async function fetchAllRSSFeeds(): Promise<RSSItem[]> {
  const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchRSSFeed(s.url, s.name)))
  return results
    .filter((r): r is PromiseFulfilledResult<RSSItem[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(item => item.title.length > 10)
}

export async function fetchTickerRSS(ticker: string): Promise<RSSItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`
  const items = await fetchRSSFeed(url, `Yahoo Finance`)
  // Tag all items with the searched ticker
  return items.map(item => ({
    ...item,
    symbols: [...new Set([ticker, ...item.symbols])],
  }))
}