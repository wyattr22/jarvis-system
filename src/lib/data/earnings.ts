import { safeFetch } from "@/lib/sandbox/whitelist"

export interface EarningsItem {
  symbol: string
  name: string
  reportDate: string   // YYYY-MM-DD
  fiscalDateEnding: string
  estimate: string
  currency: string
}

/**
 * Earnings calendar dispatcher (11.3): Finnhub primary (60 req/min free
 * tier), Alpha Vantage fallback (now only 25 req/day free — the old
 * 1h-revalidate schedule alone could exceed it).
 */
export async function getEarningsCalendar(): Promise<EarningsItem[]> {
  const { getFinnhubEarnings, hasFinnhubKey } = await import("./finnhub")
  if (hasFinnhubKey()) {
    const finnhub = await getFinnhubEarnings()
    if (finnhub.length) return finnhub
  }
  return getAlphaVantageEarnings()
}

async function getAlphaVantageEarnings(): Promise<EarningsItem[]> {
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