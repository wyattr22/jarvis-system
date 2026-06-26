import { db } from "@/lib/db/client"
import { getHoldoutBoundary } from "./holdout"

export interface StabilityResult {
  baselineR: number
  baselineWinRate: number
  perturbations: {
    paramName: string
    delta: number
    r: number
    winRate: number
    rDrop: number
    fragile: boolean
  }[]
  stabilityScore: number  // 0-1, higher = more stable
  robust: boolean
}

// Tests parameter sensitivity by comparing metric at ±10%, ±25%, ±50% deviations
// For strategy filters: simulates applying different threshold values
export async function scoreStability(
  strategyId: string,
  paramName: string,
  baselineValue: number,
  applyFilter: (trades: { r: number; featureValue: number }[], threshold: number) => number[]
): Promise<StabilityResult> {
  const holdoutBoundary = await getHoldoutBoundary()

  const result = await db.execute({
    sql: `SELECT t.r_multiple, f.value as feature_value
          FROM trades t
          JOIN signals s ON t.signal_id = s.id
          LEFT JOIN features f ON f.instrument = s.instrument
            AND f.timestamp = s.created_at
            AND f.feature_name = ?
          WHERE s.strategy_id = ?
            AND t.opened_at < ?
            AND t.r_multiple IS NOT NULL
          ORDER BY t.opened_at`,
    args: [paramName, strategyId, holdoutBoundary],
  })

  const trades = result.rows
    .filter(r => r.feature_value !== null)
    .map(r => ({ r: r.r_multiple as number, featureValue: r.feature_value as number }))

  if (trades.length < 20) {
    return { baselineR: 0, baselineWinRate: 0, perturbations: [], stabilityScore: 0, robust: false }
  }

  const evalTrades = (filtered: number[]) => {
    if (filtered.length === 0) return { r: 0, winRate: 0 }
    const r = filtered.reduce((s, v) => s + v, 0) / filtered.length
    const winRate = filtered.filter(v => v > 0).length / filtered.length
    return { r, winRate }
  }

  const baselineFiltered = applyFilter(trades, baselineValue)
  const { r: baselineR, winRate: baselineWinRate } = evalTrades(baselineFiltered)

  const deltas = [-0.5, -0.25, -0.1, 0.1, 0.25, 0.5]
  const perturbations = deltas.map(delta => {
    const testValue = baselineValue * (1 + delta)
    const filtered = applyFilter(trades, testValue)
    const { r, winRate } = evalTrades(filtered)
    const rDrop = baselineR > 0 ? (baselineR - r) / baselineR : 0
    return {
      paramName,
      delta,
      r,
      winRate,
      rDrop,
      fragile: Math.abs(delta) <= 0.25 && rDrop > 0.5, // -25% kills it = fragile
    }
  })

  const fragileCount = perturbations.filter(p => p.fragile).length
  const stabilityScore = Math.max(0, 1 - fragileCount / perturbations.length)
  const robust = fragileCount === 0

  return { baselineR, baselineWinRate, perturbations, stabilityScore, robust }
}
