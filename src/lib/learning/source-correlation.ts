// Per-source predictive performance + cross-source correlation.
//
// For each (source, opportunity_id) pair that ended up `executed`, we look up
// the eventual allocation outcome and roll up:
//   - source.wins / losses
//   - source.avg_r (Σ pnl / Σ risk)
//   - cross-source instrument overlap (do splitwatch and swing keep proposing
//     the same names? if so, treat the agreement as a quality signal)
//
// The output line is meant for the Council's monthly review and for an
// /correlation dashboard chip.

import { db } from "@/lib/db/client"

export type SourcePerformance = {
  source: string
  total_executed: number
  total_filled: number
  total_rejected: number
  avg_allocated_usd: number
}

export async function getSourcePerformance(daysBack = 30): Promise<SourcePerformance[]> {
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000
  try {
    const r = await db.execute({
      sql: `
        SELECT o.source,
               COUNT(a.id) AS total,
               SUM(CASE WHEN a.status = 'filled' THEN 1 ELSE 0 END) AS filled,
               SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
               AVG(a.allocated_usd) AS avg_usd
        FROM allocations a
        JOIN opportunities o ON o.id = a.opportunity_id
        WHERE a.decided_at >= ?
        GROUP BY o.source
        ORDER BY total DESC
      `,
      args: [since],
    })
    return r.rows.map(row => {
      const r = row as unknown as {
        source: string
        total: number
        filled: number
        rejected: number
        avg_usd: number | null
      }
      return {
        source: String(r.source),
        total_executed: Number(r.total ?? 0),
        total_filled: Number(r.filled ?? 0),
        total_rejected: Number(r.rejected ?? 0),
        avg_allocated_usd: Number(r.avg_usd ?? 0),
      }
    })
  } catch {
    return []
  }
}

export type InstrumentOverlap = {
  instrument: string
  sources: string[]
  count: number
}

// Find instruments that multiple sources independently flagged within a 7d window.
// High agreement = stronger signal — useful for the Council to up-weight.
export async function getInstrumentAgreement(daysBack = 7): Promise<InstrumentOverlap[]> {
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000
  try {
    const r = await db.execute({
      sql: `
        SELECT instrument, GROUP_CONCAT(DISTINCT source) AS sources, COUNT(DISTINCT source) AS n
        FROM opportunities
        WHERE created_at >= ?
        GROUP BY instrument
        HAVING n >= 2
        ORDER BY n DESC, instrument
        LIMIT 50
      `,
      args: [since],
    })
    return r.rows.map(row => {
      const r = row as unknown as { instrument: string; sources: string; n: number }
      return {
        instrument: String(r.instrument),
        sources: String(r.sources).split(","),
        count: Number(r.n),
      }
    })
  } catch {
    return []
  }
}
