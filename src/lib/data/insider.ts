import { safeFetch } from "@/lib/sandbox/whitelist"

export interface InsiderTransaction {
  symbol: string
  name: string         // insider name
  title: string        // CEO, CFO, Director, etc.
  transactionType: string  // P = purchase, S = sale, A = award
  shares: number
  price: number
  date: string
  value: number        // shares * price
}

// Static CIK map for most-watched tickers
const TICKER_CIK: Record<string, string> = {
  TSLA: "0001318605",
  AAPL: "0000320193",
  NVDA: "0001045810",
  MSFT: "0000789019",
  META: "0001326801",
  GOOGL: "0001652044",
  AMZN: "0001018724",
  HOOD: "0001783398",
  IONQ: "0001821822",
  RIOT: "0001167419",
  MARA: "0000858655",
  SNAP: "0001564408",
  COIN: "0001679788",
}

export async function getInsiderTransactions(symbol: string, limit = 5): Promise<InsiderTransaction[]> {
  const cik = TICKER_CIK[symbol.toUpperCase()]
  if (!cik) return []

  try {
    const res = await safeFetch(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include&count=${limit}&search_text=&output=atom`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Jarvis/2.0 research tool)" },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) return []

    const xml = await res.text()

    // Extract entry titles — format: "4 - {name} ({date})"
    const entryRegex = /<entry>[\s\S]*?<\/entry>/g
    const titleRegex = /<title>(.*?)<\/title>/
    const updatedRegex = /<updated>(.*?)<\/updated>/

    const entries = xml.match(entryRegex) ?? []
    const transactions: InsiderTransaction[] = []

    for (const entry of entries.slice(0, limit)) {
      const titleMatch = entry.match(titleRegex)
      const updatedMatch = entry.match(updatedRegex)

      const titleRaw = titleMatch?.[1] ?? ""
      const updated = updatedMatch?.[1]?.slice(0, 10) ?? ""

      // Title is like "4 - MUSK ELON (2024-01-15)"
      const nameMatch = titleRaw.match(/^4\s*-\s*(.+?)(?:\s*\([\d-]+\))?$/)
      const name = nameMatch?.[1]?.trim() ?? titleRaw

      transactions.push({
        symbol: symbol.toUpperCase(),
        name,
        title: "",
        transactionType: "",
        shares: 0,
        price: 0,
        date: updated,
        value: 0,
      })
    }

    return transactions
  } catch {
    return []
  }
}

export function formatInsiderForContext(transactions: InsiderTransaction[], symbol: string): string {
  if (!transactions.length) return ""
  return `${symbol.toUpperCase()} INSIDER: ${transactions.length} recent Form 4 filings (last 30 days)`
}

// Simpler alternative: just check if there are recent Form 4 filings
export async function hasRecentInsiderActivity(symbol: string): Promise<string> {
  const cik = TICKER_CIK[symbol.toUpperCase()]
  if (!cik) return ""

  try {
    const res = await safeFetch(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include&count=10&search_text=&output=atom`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Jarvis/2.0 research tool)" },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) return ""

    const xml = await res.text()
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const updatedMatches = xml.match(/<updated>(.*?)<\/updated>/g) ?? []
    // Skip first match — it's the feed-level <updated>, not an entry
    const entryDates = updatedMatches.slice(1)

    let count = 0
    for (const match of entryDates) {
      const dateStr = match.replace(/<\/?updated>/g, "").trim()
      const date = new Date(dateStr)
      if (!isNaN(date.getTime()) && date >= thirtyDaysAgo) count++
    }

    if (count === 0) return ""
    return `${count} insider filing${count === 1 ? "" : "s"} in last 30 days`
  } catch {
    return ""
  }
}