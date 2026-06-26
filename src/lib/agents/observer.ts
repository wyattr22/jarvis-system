import { db } from "@/lib/db/client"
import { getHoldoutBoundary } from "@/lib/validation/holdout"
import { tTestTwoSample, cumulativeStdNormalProbability } from "simple-statistics"

// Approximate two-tailed p-value from t-statistic using normal distribution
// Valid for large samples (n > 30)
function tStatToPValue(t: number): number {
  const z = Math.abs(t)
  return 2 * (1 - cumulativeStdNormalProbability(z))
}

export interface DiscoveredPattern {
  featureName: string
  threshold: number
  direction: "above" | "below"
  lift: number
  baseWinRate: number
  filteredWinRate: number
  sampleSize: number
  pValue: number
  strategyId: string
}

function pointBiserialCorrelation(binaryY: number[], continuousX: number[]): number {
  const n = binaryY.length
  if (n < 5) return 0
  const n1 = binaryY.filter(v => v === 1).length
  const n0 = n - n1
  if (n1 === 0 || n0 === 0) return 0

  const M1 = continuousX.filter((_, i) => binaryY[i] === 1).reduce((s, v) => s + v, 0) / n1
  const M0 = continuousX.filter((_, i) => binaryY[i] === 0).reduce((s, v) => s + v, 0) / n0
  const std = Math.sqrt(continuousX.reduce((s, v) => s + Math.pow(v - (continuousX.reduce((a, b) => a + b, 0) / n), 2), 0) / n)

  if (std === 0) return 0
  return ((M1 - M0) / std) * Math.sqrt((n1 * n0) / (n * n))
}

export async function runObserver(): Promise<DiscoveredPattern[]> {
  const holdoutBoundary = await getHoldoutBoundary()

  const result = await db.execute({
    sql: `SELECT s.strategy_id, s.feature_snapshot_json, t.r_multiple
          FROM trades t
          JOIN signals s ON t.signal_id = s.id
          WHERE t.r_multiple IS NOT NULL
            AND s.feature_snapshot_json IS NOT NULL
            AND t.opened_at < ?
          ORDER BY t.opened_at DESC
          LIMIT 2000`,
    args: [holdoutBoundary],
  })

  if (result.rows.length < 50) return []

  type TradeRecord = {
    strategyId: string
    r: number
    won: number
    features: Record<string, number>
  }

  const records: TradeRecord[] = []
  for (const row of result.rows) {
    try {
      const features = JSON.parse(row.feature_snapshot_json as string)
      records.push({
        strategyId: row.strategy_id as string,
        r: row.r_multiple as number,
        won: (row.r_multiple as number) > 0 ? 1 : 0,
        features,
      })
    } catch { continue }
  }

  if (records.length < 30) return []

  const patterns: DiscoveredPattern[] = []
  const strategies = [...new Set(records.map(r => r.strategyId))]

  for (const strategyId of strategies) {
    const strat = records.filter(r => r.strategyId === strategyId)
    if (strat.length < 30) continue

    const baseWinRate = strat.filter(r => r.won).length / strat.length
    const allFeatureNames = [...new Set(strat.flatMap(r => Object.keys(r.features)))]

    // Rank features by point-biserial correlation with win/loss
    const ranked = allFeatureNames
      .map(name => {
        const xs = strat.map(r => r.features[name] ?? 0)
        const ys = strat.map(r => r.won)
        return { name, corr: Math.abs(pointBiserialCorrelation(ys, xs)) }
      })
      .sort((a, b) => b.corr - a.corr)
      .slice(0, 15)

    for (const { name } of ranked) {
      const values = strat.map(r => r.features[name] ?? 0)
      const sorted = [...values].sort((a, b) => a - b)

      for (const quantile of [0.25, 0.5, 0.75]) {
        const threshold = sorted[Math.floor(sorted.length * quantile)]

        for (const direction of ["above", "below"] as const) {
          const filtered = strat.filter(r =>
            direction === "above"
              ? (r.features[name] ?? 0) > threshold
              : (r.features[name] ?? 0) < threshold
          )
          const rest = strat.filter(r =>
            direction === "above"
              ? (r.features[name] ?? 0) <= threshold
              : (r.features[name] ?? 0) >= threshold
          )

          if (filtered.length < 15 || rest.length < 5) continue

          const filteredWinRate = filtered.filter(r => r.won).length / filtered.length
          const lift = baseWinRate > 0 ? filteredWinRate / baseWinRate : 1
          if (lift < 1.15) continue

          let pValue = 1
          try {
            const filteredR = filtered.map(r => r.r)
            const restR = rest.map(r => r.r)
            const tStat = tTestTwoSample(filteredR, restR) ?? 0
            pValue = tStatToPValue(tStat)
          } catch { continue }

          if (pValue < 0.1) {
            patterns.push({
              featureName: name,
              threshold,
              direction,
              lift,
              baseWinRate,
              filteredWinRate,
              sampleSize: filtered.length,
              pValue,
              strategyId,
            })
          }
        }
      }
    }
  }

  const ranked = patterns
    .sort((a, b) => (b.lift * (1 - b.pValue)) - (a.lift * (1 - a.pValue)))
    .slice(0, 20)

  // Ensure watchlist table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS watchlist (
      instrument TEXT NOT NULL,
      added_by TEXT NOT NULL,
      reason TEXT,
      pattern_json TEXT,
      lift REAL,
      p_value REAL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (instrument, added_by)
    )
  `)

  for (const p of ranked) {
    const id = `${p.strategyId}-${p.featureName}-${p.direction}-${Date.now()}`
    await db.execute({
      sql: `INSERT OR REPLACE INTO patterns (id, discovered_by, pattern_json, validated, created_at)
            VALUES (?, 'observer_ml', ?, 0, ?)`,
      args: [id, JSON.stringify(p), Date.now()],
    })

    // High-conviction patterns (lift > 1.3, p < 0.05) → add instrument to watchlist
    if (p.lift > 1.3 && p.pValue < 0.05) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO watchlist (instrument, added_by, reason, pattern_json, lift, p_value, created_at)
              VALUES (?, 'observer', ?, ?, ?, ?, ?)`,
        args: [
          p.strategyId,
          `${p.featureName} ${p.direction} threshold ${p.threshold.toFixed(3)} → ${(p.lift * 100 - 100).toFixed(0)}% lift`,
          JSON.stringify(p),
          p.lift,
          p.pValue,
          Date.now(),
        ],
      })
    }
  }

  return ranked
}
