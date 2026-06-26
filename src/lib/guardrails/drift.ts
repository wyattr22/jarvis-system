import { db } from "@/lib/db/client"
import { LIMITS } from "./limits"
import { auditLog } from "./audit"

export interface DriftCheckResult {
  strategyId: string
  expectedR: number
  actualR: number
  divergenceSigma: number
  autoPaused: boolean
  message: string
}

export async function checkDrift(strategyId: string): Promise<DriftCheckResult> {
  const window = LIMITS.DRIFT_TRADE_WINDOW

  // Get backtest expected R from walk-forward result stored in proposals
  const proposalRow = await db.execute({
    sql: `SELECT walk_forward_result_json FROM proposals
          WHERE strategy_id = ? AND status = 'promoted'
          ORDER BY decided_at DESC LIMIT 1`,
    args: [strategyId],
  })

  let expectedR = 1.0
  if (proposalRow.rows.length > 0) {
    try {
      const wf = JSON.parse(proposalRow.rows[0].walk_forward_result_json as string)
      expectedR = wf.avgR ?? 1.0
    } catch { /* use default */ }
  }

  // Get last N live trades
  const tradesRow = await db.execute({
    sql: `SELECT t.r_multiple
          FROM trades t
          JOIN signals s ON t.signal_id = s.id
          WHERE s.strategy_id = ? AND t.r_multiple IS NOT NULL AND t.closed_at IS NOT NULL
          ORDER BY t.closed_at DESC LIMIT ?`,
    args: [strategyId, window],
  })

  if (tradesRow.rows.length < window) {
    return {
      strategyId,
      expectedR,
      actualR: 0,
      divergenceSigma: 0,
      autoPaused: false,
      message: `Only ${tradesRow.rows.length}/${window} trades — not enough data`,
    }
  }

  const rs = tradesRow.rows.map(r => r.r_multiple as number)
  const actualR = rs.reduce((s, v) => s + v, 0) / rs.length
  const std = Math.sqrt(rs.reduce((s, v) => s + Math.pow(v - actualR, 2), 0) / rs.length)
  const se = std / Math.sqrt(window)
  const divergenceSigma = se > 0 ? Math.abs(actualR - expectedR) / se : 0

  let autoPaused = false
  if (divergenceSigma > LIMITS.DRIFT_SIGMA_THRESHOLD) {
    // Auto-pause: update strategy enabled flag
    await db.execute({
      sql: "UPDATE strategies SET enabled = 0 WHERE id = ?",
      args: [strategyId],
    })
    await db.execute({
      sql: `INSERT INTO drift_log (strategy_id, window_start, window_end, expected_r, actual_r, divergence_sigma, auto_paused)
            VALUES (?, ?, ?, ?, ?, ?, 1)`,
      args: [strategyId, Date.now() - window * 86400000, Date.now(), expectedR, actualR, divergenceSigma],
    })
    await auditLog("drift_monitor", "auto_paused_strategy", {
      strategyId, divergenceSigma, expectedR, actualR,
    })
    autoPaused = true
  }

  return {
    strategyId,
    expectedR,
    actualR,
    divergenceSigma,
    autoPaused,
    message: autoPaused
      ? `AUTO-PAUSED: ${divergenceSigma.toFixed(1)}σ divergence (expected ${expectedR.toFixed(2)}R, got ${actualR.toFixed(2)}R)`
      : `OK: ${divergenceSigma.toFixed(1)}σ divergence`,
  }
}
