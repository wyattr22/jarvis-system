import { safeFetch } from "@/lib/sandbox/whitelist"

export interface EarningsItem {
  symbol: string
  name: string
  reportDate: string   // YYYY-MM-DD
  fiscalDateEnding: string
  estimate: string
  currency: string
}

export async function getEarningsCalendar(): Promise<EarningsItem[]> {
  const key = process.env.ALPHA_VANTAGE_KEY
  if (!key) return []

  try {
    const res = await safeFetch(
      `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${key}`,
      { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return []
    const text = await res.text()
    if (!text.includes(',')) return []  // not CSV — probably error JSON
    const lines = text.trim().split('\n')
    if (lines.length < 2) return []
    return lines.slice(1)
      .map(line => {
        const parts = line.split(',')
        return {
          symbol: parts[0]?.trim() ?? '',
          name: parts[1]?.trim() ?? '',
          reportDate: parts[2]?.trim() ?? '',
          fiscalDateEnding: parts[3]?.trim() ?? '',
          estimate: parts[4]?.trim() ?? '',
          currency: parts[5]?.trim() ?? 'USD',
        }
      })
      .filter(e => e.symbol && e.reportDate)
      .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
  } catch {
    return []
  }
}