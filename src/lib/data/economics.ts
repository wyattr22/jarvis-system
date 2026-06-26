import { safeFetch } from "@/lib/sandbox/whitelist"

export interface EconomicEvent {
  name: string
  date: string       // YYYY-MM-DD
  time: string       // HH:MM or empty
  impact: string     // HIGH, MEDIUM, LOW or empty
  forecast: string
  previous: string
}

export async function getTodaysEconomicEvents(): Promise<EconomicEvent[]> {
  const key = process.env.ALPHA_VANTAGE_KEY
  if (!key) return []

  try {
    const res = await safeFetch(
      `https://www.alphavantage.co/query?function=ECONOMIC_CALENDAR&horizon=3month&apikey=${key}`,
      {
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) return []

    const csv = await res.text()
    const today = new Date().toISOString().slice(0, 10)

    const lines = csv.split("\n").filter((l) => l.trim().length > 0)
    if (lines.length < 2) return []

    // Parse header to find column indices
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase())
    const col = (name: string) => header.indexOf(name)

    const idxName = col("name") !== -1 ? col("name") : col("event")
    const idxDate = col("date")
    const idxTime = col("time")
    const idxImpact = col("impact")
    const idxForecast = col("forecast")
    const idxPrevious = col("previous")

    const events: EconomicEvent[] = []

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim())
      const date = idxDate !== -1 ? (cols[idxDate] ?? "") : ""
      if (!date.startsWith(today)) continue

      events.push({
        name: idxName !== -1 ? (cols[idxName] ?? "") : "",
        date,
        time: idxTime !== -1 ? (cols[idxTime] ?? "") : "",
        impact: idxImpact !== -1 ? (cols[idxImpact] ?? "").toUpperCase() : "",
        forecast: idxForecast !== -1 ? (cols[idxForecast] ?? "") : "",
        previous: idxPrevious !== -1 ? (cols[idxPrevious] ?? "") : "",
      })
    }

    return events
  } catch {
    return []
  }
}

export function formatEconomicsForContext(events: EconomicEvent[]): string {
  if (!events.length) return ""

  const formatted = events
    .map((e) => {
      const parts: string[] = [e.name]
      if (e.impact) parts.push(e.impact)
      if (e.time) parts.push(e.time)
      if (e.forecast) parts.push(`forecast ${e.forecast}`)
      if (e.previous) parts.push(`prev ${e.previous}`)
      return parts.join(", ")
    })
    .join(") | (")

  return `TODAY'S EVENTS: (${formatted})`
}