// For each approved proposal that's at least 30 days past its decision date,
// measure the change in avg r_multiple before vs after approval and persist
// the result. Used to grade Critics and surface in the council's reasoning.

import { db } from "@/lib/db/client"

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

let tableReady = false
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS proposal_outcomes (
      proposal_id TEXT PRIMARY KEY,
      strategy_id TEXT,
      baseline_avg_r REAL,
      post_avg_r REAL,
      delta_r REAL,
      trade_count_pre INTEGER,
      trade_count_post INTEGER,
      measured_at INTEGER NOT NULL
    )
  `)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_outcomes_strategy ON proposal_outcomes(strategy_id)`)
  tableReady = true
}

async function avgRForRange(strategyId: string | null, from: number, to: number): Promise<{ avg: number; count: number }> {
  const result = strategyId
    ? await db.execute({
        sql: `
          SELECT AVG(t.r_multiple) AS avg_r, COUNT(t.r_multiple) AS n
          FROM trades t
          LEFT JOIN attribution a ON a.trade_id = t.id
          WHERE t.r_multiple IS NOT NULL
            AND t.opened_at >= ?
            AND t.opened_at <= ?
            AND (a.strategy_id = ? OR a.strategy_id IS NULL)
        `,
        args: [from, to, strategyId],
      })
    : await db.execute({
        sql: `
          SELECT AVG(r_multiple) AS avg_r, COUNT(r_multiple) AS n
          FROM trades
          WHERE r_multiple IS NOT NULL AND opened_at >= ? AND opened_at <= ?
        `,
        args: [from, to],
      })
  const row = result.rows[0] as any
  return {
    avg: row.avg_r === null ? 0 : Number(row.avg_r),
    count: Number(row.n ?? 0),
  }
}

export async function runOutcomeTracker(): Promise<{
  measured: number
  skipped: number
  details: Array<{ id: string; delta_r: number; pre_n: number; post_n: number }>
}> {
  await ensureTable()
  const cutoff = Date.now() - WINDOW_MS

  // Approved proposals at least 30d old, without an outcome row yet
  const due = await db.execute({
    sql: `
      SELECT p.id, p.strategy_id, p.decided_at
      FROM proposals p
      LEFT JOIN proposal_outcomes o ON o.proposal_id = p.id
      WHERE p.status = 'approved'
        AND p.decided_at IS NOT NULL
        AND p.decided_at <= ?
        AND o.proposal_id IS NULL
      ORDER BY p.decided_at ASC
      LIMIT 25
    `,
    args: [cutoff],
  })

  const details: Array<{ id: string; delta_r: number; pre_n: number; post_n: number }> = []
  let measured = 0
  let skipped = 0

  for (const row of due.rows) {
    const id = String((row as any).id)
    const strategyId = (row as any).strategy_id ? String((row as any).strategy_id) : null
    const decidedAt = Number((row as any).decided_at)
    const pre = await avgRForRange(strategyId, decidedAt - WINDOW_MS, decidedAt - 1)
    const post = await avgRForRange(strategyId, decidedAt + 1, decidedAt + WINDOW_MS)

    if (pre.count < 3 || post.count < 3) {
      skipped++
      continue  // insufficient data — try again next cron tick when more trades arrive
    }

    const deltaR = post.avg - pre.avg
    await db.execute({
      sql: `INSERT INTO proposal_outcomes (proposal_id, strategy_id, baseline_avg_r, post_avg_r, delta_r, trade_count_pre, trade_count_post, measured_at)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [id, strategyId, pre.avg, post.avg, deltaR, pre.count, post.count, Date.now()],
    })
    details.push({ id, delta_r: deltaR, pre_n: pre.count, post_n: post.count })
    measured++

    // Feed the result back into agent_scores so the Critics that voted on this
    // proposal get credit (or debit) for the eventual outcome.
    try {
      const verdict = deltaR >= 0 ? 'positive' : 'negative'
      await db.execute({
        sql: `
          UPDATE agent_scores
          SET outcome = ?, pnl_impact = ?, scored_at = ?
          WHERE output_id IN (
            SELECT id FROM agent_outputs WHERE proposal_id = ?
          )
        `,
        args: [verdict, deltaR, Date.now(), id],
      })
    } catch { /* agent_outputs.proposal_id may not exist on every schema; ignore */ }
  }

  return { measured, skipped, details }
}
