// Watchlist intelligence — auto-promote/demote symbols based on opportunity flow.
//
// Promote: symbol mentioned in 3+ open opportunities OR has avg confidence > 0.7
// Demote: symbol that's been muted 3+ times in last 30d (signal user dislikes it)
//
// Runs as a daily cron. Writes additions tagged `added_by='watchlist-intel'`
// so they're distinguishable from Observer / user-added rows.

import { db } from "@/lib/db/client"

const DAY = 24 * 60 * 60 * 1000
const PROMOTE_OPP_COUNT = 3
const PROMOTE_AVG_CONFIDENCE = 0.7
const DEMOTE_MUTE_COUNT = 3
const LOOKBACK_DAYS = 30

async function ensureWatchlist(): Promise<void> {
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
}

export type PromotionDecision = {
  instrument: string
  action: "promote" | "demote" | "skip"
  reason: string
}

export async function runWatchlistIntel(): Promise<{ decisions: PromotionDecision[] }> {
  await ensureWatchlist()
  const since = Date.now() - LOOKBACK_DAYS * DAY
  const decisions: PromotionDecision[] = []

  // Promotion candidates: symbols with multiple open opportunities or high avg confidence
  const promoteRows = await db.execute({
    sql: `
      SELECT instrument,
             COUNT(*) AS n,
             AVG(COALESCE(confidence, 0)) AS avg_conf,
             GROUP_CONCAT(DISTINCT source) AS sources
      FROM opportunities
      WHERE status IN ('open', 'claimed')
        AND created_at >= ?
      GROUP BY instrument
      HAVING n >= ? OR avg_conf >= ?
    `,
    args: [since, PROMOTE_OPP_COUNT, PROMOTE_AVG_CONFIDENCE],
  }).catch(() => ({ rows: [] }))

  for (const row of promoteRows.rows) {
    const r = row as unknown as {
      instrument: string
      n: number
      avg_conf: number
      sources: string
    }
    const reason = `${r.n} active opportunities (avg confidence ${Number(r.avg_conf).toFixed(2)}) from ${r.sources}`
    await db.execute({
      sql: `INSERT OR REPLACE INTO watchlist
              (instrument, added_by, reason, pattern_json, lift, p_value, created_at)
            VALUES (?, 'watchlist-intel', ?, NULL, NULL, NULL, ?)`,
      args: [String(r.instrument).toUpperCase(), reason, Date.now()],
    })
    decisions.push({
      instrument: String(r.instrument).toUpperCase(),
      action: "promote",
      reason,
    })
  }

  // Demotion candidates: symbols muted repeatedly in window
  const muteRows = await db.execute({
    sql: `
      SELECT instrument, COUNT(*) AS n
      FROM opportunities
      WHERE status = 'muted' AND updated_at >= ?
      GROUP BY instrument
      HAVING n >= ?
    `,
    args: [since, DEMOTE_MUTE_COUNT],
  }).catch(() => ({ rows: [] }))

  for (const row of muteRows.rows) {
    const r = row as unknown as { instrument: string; n: number }
    const instrument = String(r.instrument).toUpperCase()
    // Only demote if WE added it — don't fight the user's manual additions
    const existing = await db.execute({
      sql: `SELECT 1 FROM watchlist WHERE instrument = ? AND added_by = 'watchlist-intel' LIMIT 1`,
      args: [instrument],
    })
    if (existing.rows.length === 0) {
      decisions.push({
        instrument,
        action: "skip",
        reason: `muted ${r.n}x but not on auto-watchlist`,
      })
      continue
    }
    await db.execute({
      sql: `DELETE FROM watchlist WHERE instrument = ? AND added_by = 'watchlist-intel'`,
      args: [instrument],
    })
    decisions.push({
      instrument,
      action: "demote",
      reason: `muted ${r.n}x in last ${LOOKBACK_DAYS}d`,
    })
  }

  return { decisions }
}
