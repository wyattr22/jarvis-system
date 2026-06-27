// Time-stop monitor.
//
// Joins live positions back to the opportunity row that spawned them
// (via allocations.opportunity_id), checks each opportunity's `horizon_days`,
// and flags positions that have been held longer than their intended horizon.
//
// Surfaces these as audit_log entries + push notifications. The user (or a
// future auto-close cron) decides what to do.

import { db } from "@/lib/db/client"
import type { Position } from "@/lib/brokers/adapter"

export type TimeStopAlert = {
  symbol: string
  opportunity_id: string
  source: string
  thesis: string
  horizon_days: number
  days_held: number
  overshoot_days: number
  current_unrealized_pl: number
}

// Pulls horizon + opened_at via the allocations → opportunities chain.
// Positions without a matching allocation are skipped (they came from
// outside the allocator and we don't know their intended horizon).
export async function computeTimeStops(positions: Position[]): Promise<TimeStopAlert[]> {
  if (positions.length === 0) return []
  const symbols = [...new Set(positions.map(p => p.symbol.toUpperCase()))]
  const placeholders = symbols.map(() => "?").join(",")

  const rows = await db.execute({
    sql: `
      SELECT o.instrument, o.id AS opportunity_id, o.source, o.thesis,
             o.horizon_days, a.decided_at
      FROM allocations a
      JOIN opportunities o ON o.id = a.opportunity_id
      WHERE a.status IN ('submitted', 'filled')
        AND o.horizon_days IS NOT NULL
        AND UPPER(o.instrument) IN (${placeholders})
      ORDER BY a.decided_at DESC
    `,
    args: symbols,
  })

  const alerts: TimeStopAlert[] = []
  const seenSymbols = new Set<string>()

  for (const row of rows.rows) {
    const r = row as unknown as {
      instrument: string
      opportunity_id: string
      source: string
      thesis: string
      horizon_days: number
      decided_at: number
    }
    const sym = String(r.instrument).toUpperCase()
    if (seenSymbols.has(sym)) continue  // only most-recent alloc per symbol
    seenSymbols.add(sym)

    const daysHeld = (Date.now() - Number(r.decided_at)) / (24 * 60 * 60 * 1000)
    const horizon = Number(r.horizon_days)
    if (daysHeld <= horizon) continue

    const position = positions.find(p => p.symbol.toUpperCase() === sym)
    if (!position) continue

    alerts.push({
      symbol: sym,
      opportunity_id: String(r.opportunity_id),
      source: String(r.source),
      thesis: String(r.thesis).slice(0, 200),
      horizon_days: horizon,
      days_held: Math.floor(daysHeld * 10) / 10,
      overshoot_days: Math.floor((daysHeld - horizon) * 10) / 10,
      current_unrealized_pl: position.unrealized_pl,
    })
  }

  return alerts.sort((a, b) => b.overshoot_days - a.overshoot_days)
}
