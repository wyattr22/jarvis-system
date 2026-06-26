import { db } from "@/lib/db/client"

export interface JournalInsights {
  winRateByHour: Record<string, { wins: number; total: number; winPct: number }>
  winRateByDay: Record<string, { wins: number; total: number; winPct: number }>
  avgRBySession: { am: number; pm: number }  // AM = before 10am, PM = after 10am
  bestHour: string
  worstHour: string
  behavioralNote: string  // one coaching note
  totalTrades: number
  winRate: number
  avgR: number
}

export async function getJournalInsights(): Promise<JournalInsights | null> {
  try {
    const trades = await db.execute({
      sql: "SELECT opened_at, r_multiple, side FROM trades WHERE r_multiple IS NOT NULL ORDER BY opened_at DESC LIMIT 200",
      args: [],
    })
    if (!trades.rows.length) return null

    const rows = trades.rows as unknown as { opened_at: number | string; r_multiple: number; side: string }[]

    // Group by hour
    const byHour: Record<string, number[]> = {}
    const byDay: Record<string, number[]> = {}
    let amR = 0, amCount = 0, pmR = 0, pmCount = 0
    let totalWins = 0

    for (const row of rows) {
      const ts = typeof row.opened_at === 'number' ? row.opened_at : Date.parse(String(row.opened_at))
      const d = new Date(ts)
      const hour = d.getHours()
      const dayOfWeek = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
      const r = Number(row.r_multiple)

      const hKey = `${hour}:00`
      if (!byHour[hKey]) byHour[hKey] = []
      byHour[hKey].push(r)

      if (!byDay[dayOfWeek]) byDay[dayOfWeek] = []
      byDay[dayOfWeek].push(r)

      if (hour < 10) { amR += r; amCount++ }
      else { pmR += r; pmCount++ }

      if (r > 0) totalWins++
    }

    const toStats = (map: Record<string, number[]>) => {
      const result: Record<string, { wins: number; total: number; winPct: number }> = {}
      for (const [key, rs] of Object.entries(map)) {
        const wins = rs.filter(r => r > 0).length
        result[key] = { wins, total: rs.length, winPct: Math.round((wins / rs.length) * 100) }
      }
      return result
    }

    const winRateByHour = toStats(byHour)
    const winRateByDay = toStats(byDay)

    // Find best/worst hours with enough samples
    const hoursWithData = Object.entries(winRateByHour).filter(([, v]) => v.total >= 3)
    const bestHour = hoursWithData.slice().sort((a, b) => b[1].winPct - a[1].winPct)[0]?.[0] ?? ""
    const worstHour = hoursWithData.slice().sort((a, b) => a[1].winPct - b[1].winPct)[0]?.[0] ?? ""

    const totalTrades = rows.length
    const winRate = Math.round((totalWins / totalTrades) * 100)
    const allR = rows.map(r => Number(r.r_multiple))
    const avgR = allR.reduce((a, b) => a + b, 0) / allR.length

    // Behavioral coaching note
    let behavioralNote = ""
    if (bestHour && worstHour && bestHour !== worstHour) {
      behavioralNote = `Your best hour is ${bestHour} and worst is ${worstHour}.`
    }
    if (amCount >= 5 && pmCount >= 5) {
      const amWinPct = amR / amCount
      const pmWinPct = pmR / pmCount
      if (amWinPct > pmWinPct * 1.2) behavioralNote += " You perform significantly better in the morning session."
      else if (pmWinPct > amWinPct * 1.2) behavioralNote += " You perform better in the afternoon — consider skipping the morning rush."
    }
    if (!behavioralNote) behavioralNote = `${winRate}% win rate across ${totalTrades} trades.`

    return {
      winRateByHour,
      winRateByDay,
      avgRBySession: {
        am: amCount > 0 ? amR / amCount : 0,
        pm: pmCount > 0 ? pmR / pmCount : 0,
      },
      bestHour,
      worstHour,
      behavioralNote,
      totalTrades,
      winRate,
      avgR,
    }
  } catch {
    return null
  }
}

export function formatJournalForContext(insights: JournalInsights): string {
  const lines = [
    `TRADING JOURNAL: ${insights.totalTrades} trades, ${insights.winRate}% win rate, avg R=${insights.avgR.toFixed(2)}`,
  ]
  if (insights.behavioralNote) lines.push(`COACHING NOTE: ${insights.behavioralNote}`)
  return lines.join('\n')
}
