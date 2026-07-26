import { db } from "@/lib/db/client"
import { getHoldoutBoundary } from "./holdout"

export interface SimTrade {
  instrument: string
  direction: string
  r_multiple: number
  pnl: number | null
  opened_at: number
  closed_at: number | null
  regime_tag: string | null
}

export interface InMemoryWalkForwardResult {
  windows: Array<{
    trainStart: number; trainEnd: number
    testStart: number; testEnd: number
    testR: number; testWinRate: number; testSharpe: number; passed: boolean
  }>
  avgR: number
  avgWinRate: number
  avgSharpe: number
  consistent: boolean
  passedMinWindows: boolean
}

/**
 * Walk-forward validation over freshly-simulated (not yet-live) trades —
 * extracted from the backtest route (Phase 17) so a strategy with zero live
 * trade history (any brand-new candidate, human- or LLM-authored) can still
 * be validated against its own backtest, rather than failing runWalkForward
 * below purely for lack of history it can't possibly have yet.
 */
export function backtestWalkForward(
  trades: SimTrade[],
  trainMonths = 2,
  testMonths = 1,
): InMemoryWalkForwardResult {
  if (trades.length < 20) {
    return { windows: [], avgR: 0, avgWinRate: 0, avgSharpe: 0, consistent: false, passedMinWindows: false }
  }

  const MS_MONTH = 30 * 86_400_000
  const first = Math.min(...trades.map(t => t.opened_at))
  const last = Math.max(...trades.map(t => t.opened_at))

  const windows: InMemoryWalkForwardResult["windows"] = []

  let cursor = first
  while (cursor + (trainMonths + testMonths) * MS_MONTH <= last) {
    const testStart = cursor + trainMonths * MS_MONTH
    const testEnd = testStart + testMonths * MS_MONTH
    const batch = trades.filter(t => t.opened_at >= testStart && t.opened_at < testEnd)

    if (batch.length >= 3) {
      const rs = batch.map(t => t.r_multiple)
      const avgR = rs.reduce((s, r) => s + r, 0) / rs.length
      const winRate = rs.filter(r => r > 0).length / rs.length
      const std = Math.sqrt(rs.reduce((s, r) => s + (r - avgR) ** 2, 0) / rs.length)
      windows.push({
        trainStart: cursor, trainEnd: testStart, testStart, testEnd,
        testR: avgR, testWinRate: winRate,
        testSharpe: std > 0 ? avgR / std : 0,
        passed: avgR > 0 && winRate > 0.40,
      })
    }
    cursor += testMonths * MS_MONTH
  }

  if (!windows.length) {
    return { windows: [], avgR: 0, avgWinRate: 0, avgSharpe: 0, consistent: false, passedMinWindows: false }
  }

  const avgR = windows.reduce((s, w) => s + w.testR, 0) / windows.length
  const avgWinRate = windows.reduce((s, w) => s + w.testWinRate, 0) / windows.length
  const avgSharpe = windows.reduce((s, w) => s + w.testSharpe, 0) / windows.length
  const rs = windows.map(w => w.testR)
  const consistent = Math.max(...rs) <= Math.abs(Math.min(...rs)) * 1.5 + 0.1 || windows.every(w => w.passed)
  return { windows, avgR, avgWinRate, avgSharpe, consistent, passedMinWindows: windows.length >= 4 }
}

export interface WalkForwardWindow {
  trainStart: number
  trainEnd: number
  testStart: number
  testEnd: number
  trainTrades: number
  testTrades: number
  testR: number
  testWinRate: number
  testSharpe: number
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[]
  avgR: number
  avgWinRate: number
  avgSharpe: number
  consistent: boolean    // best window doesn't outperform worst by >50%
  passedMinWindows: boolean
}

const MIN_WINDOWS = 5
const OVERFIT_RATIO = 1.5  // reject if best > worst * 1.5

export async function runWalkForward(
  strategyId: string,
  trainMonths = 3,
  testMonths = 1
): Promise<WalkForwardResult> {
  const holdoutBoundary = await getHoldoutBoundary()

  const result = await db.execute({
    sql: `SELECT t.opened_at, t.closed_at, t.r_multiple
          FROM trades t
          JOIN signals s ON t.signal_id = s.id
          WHERE s.strategy_id = ?
            AND t.opened_at IS NOT NULL
            AND t.r_multiple IS NOT NULL
            AND t.opened_at < ?
          ORDER BY t.opened_at ASC`,
    args: [strategyId, holdoutBoundary],
  })

  if (result.rows.length < MIN_WINDOWS * 10) {
    return {
      windows: [],
      avgR: 0,
      avgWinRate: 0,
      avgSharpe: 0,
      consistent: false,
      passedMinWindows: false,
    }
  }

  const trades = result.rows.map(r => ({
    openedAt: r.opened_at as number,
    r: r.r_multiple as number,
  }))

  const minTs = trades[0].openedAt
  const maxTs = trades[trades.length - 1].openedAt
  const trainMs = trainMonths * 30 * 86400000
  const testMs = testMonths * 30 * 86400000
  const windowMs = trainMs + testMs

  const windows: WalkForwardWindow[] = []
  let start = minTs

  while (start + windowMs <= maxTs) {
    const trainStart = start
    const trainEnd = start + trainMs
    const testStart = trainEnd
    const testEnd = trainEnd + testMs

    const trainTrades = trades.filter(t => t.openedAt >= trainStart && t.openedAt < trainEnd)
    const testTrades = trades.filter(t => t.openedAt >= testStart && t.openedAt < testEnd)

    if (testTrades.length >= 5) {
      const testR = testTrades.reduce((s, t) => s + t.r, 0) / testTrades.length
      const testWinRate = testTrades.filter(t => t.r > 0).length / testTrades.length
      const mean = testTrades.reduce((s, t) => s + t.r, 0) / testTrades.length
      const std = Math.sqrt(testTrades.reduce((s, t) => s + Math.pow(t.r - mean, 2), 0) / testTrades.length)
      const testSharpe = std > 0 ? mean / std : 0

      windows.push({
        trainStart, trainEnd, testStart, testEnd,
        trainTrades: trainTrades.length,
        testTrades: testTrades.length,
        testR, testWinRate, testSharpe,
      })
    }

    start += testMs // slide by one test period
  }

  if (windows.length < MIN_WINDOWS) {
    return { windows, avgR: 0, avgWinRate: 0, avgSharpe: 0, consistent: false, passedMinWindows: false }
  }

  const avgR = windows.reduce((s, w) => s + w.testR, 0) / windows.length
  const avgWinRate = windows.reduce((s, w) => s + w.testWinRate, 0) / windows.length
  const avgSharpe = windows.reduce((s, w) => s + w.testSharpe, 0) / windows.length

  const bestR = Math.max(...windows.map(w => w.testR))
  const worstR = Math.min(...windows.map(w => w.testR))
  const consistent = worstR >= 0 ? bestR <= worstR * OVERFIT_RATIO : Math.abs(bestR) < Math.abs(worstR) * OVERFIT_RATIO

  return { windows, avgR, avgWinRate, avgSharpe, consistent, passedMinWindows: true }
}
