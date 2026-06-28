// Source reliability feedback loop.
//
// For each opportunity source, computes a track-record score from its
// recent allocation outcomes. Writes to `source_reliability` table so the
// allocator scorer can multiply opportunity scores by source reputation.
//
// Inputs: trades.r_multiple joined back to opportunities (via allocations)
// Output: per-source (avg_r, fill_rate, sample_size, reliability_score)

import { db } from "@/lib/db/client"

const DAY = 24 * 60 * 60 * 1000

export type SourceReliability = {
  source: string
  sample_size: number
  avg_r: number
  fill_rate: number          // of total executed: how many got filled (rest errored)
  reliability_score: number  // 0..1 composite
  updated_at: number
}

let tableReady = false
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS source_reliability (
      source TEXT PRIMARY KEY,
      sample_size INTEGER NOT NULL,
      avg_r REAL NOT NULL,
      fill_rate REAL NOT NULL,
      reliability_score REAL NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  tableReady = true
}

// Map (avg_r, sample size) to a 0..1 reliability score.
// avg_r contributes via tanh so a few outliers don't dominate;
// small sample size discounts the score (we don't trust < 5 samples).
function computeScore(avg_r: number, sample_size: number, fill_rate: number): number {
  if (sample_size < 5) return 0.5  // insufficient data — neutral
  const rContribution = (Math.tanh(avg_r) + 1) / 2  // [-inf, +inf] → [0, 1]
  return Math.min(1, Math.max(0, 0.7 * rContribution + 0.3 * fill_rate))
}

export async function recomputeSourceReliability(daysBack = 60): Promise<SourceReliability[]> {
  await ensureTable()
  const since = Date.now() - daysBack * DAY

  // Join: trades (r_multiple) → allocations (executed) → opportunities (source)
  const r = await db.execute({
    sql: `
      SELECT o.source,
             AVG(t.r_multiple) AS avg_r,
             COUNT(DISTINCT t.id) AS sample_size,
             AVG(CASE WHEN a.status = 'filled' THEN 1.0
                      WHEN a.status = 'rejected' OR a.status = 'error' THEN 0.0
                      ELSE 0.5 END) AS fill_rate
      FROM trades t
      JOIN allocations a ON a.opportunity_id IN (
        SELECT opportunity_id FROM allocations WHERE order_id = t.signal_id
      )
      JOIN opportunities o ON o.id = a.opportunity_id
      WHERE t.r_multiple IS NOT NULL AND t.opened_at >= ?
      GROUP BY o.source
      HAVING sample_size > 0
    `,
    args: [since],
  }).catch(() => ({ rows: [] }))

  const now = Date.now()
  const results: SourceReliability[] = []

  for (const row of r.rows) {
    const data = row as unknown as {
      source: string
      avg_r: number
      sample_size: number
      fill_rate: number
    }
    const sampleSize = Number(data.sample_size)
    const avgR = Number(data.avg_r ?? 0)
    const fillRate = Number(data.fill_rate ?? 0)
    const score = computeScore(avgR, sampleSize, fillRate)

    await db.execute({
      sql: `INSERT INTO source_reliability (source, sample_size, avg_r, fill_rate, reliability_score, updated_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(source) DO UPDATE
              SET sample_size = ?, avg_r = ?, fill_rate = ?, reliability_score = ?, updated_at = ?`,
      args: [
        data.source, sampleSize, avgR, fillRate, score, now,
        sampleSize, avgR, fillRate, score, now,
      ],
    })

    results.push({
      source: String(data.source),
      sample_size: sampleSize,
      avg_r: avgR,
      fill_rate: fillRate,
      reliability_score: score,
      updated_at: now,
    })
  }

  return results
}

export async function getSourceReliability(source: string): Promise<SourceReliability | null> {
  try {
    await ensureTable()
    const r = await db.execute({
      sql: `SELECT * FROM source_reliability WHERE source = ?`,
      args: [source],
    })
    if (!r.rows.length) return null
    return r.rows[0] as unknown as SourceReliability
  } catch {
    return null
  }
}

export async function listSourceReliability(): Promise<SourceReliability[]> {
  try {
    await ensureTable()
    const r = await db.execute(`SELECT * FROM source_reliability ORDER BY reliability_score DESC`)
    return r.rows.map(row => row as unknown as SourceReliability)
  } catch {
    return []
  }
}

// Pure helper exposed for testing.
export const _computeScoreForTesting = computeScore
