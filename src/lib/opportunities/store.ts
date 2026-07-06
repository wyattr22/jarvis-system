// Unified cross-project opportunity feed.
//
// Any project (splitwatch, swing_scanner, trading_bot, jarvis-system itself)
// writes opportunities into this single table via the ingest endpoint.
// The allocator (Phase 4) reads from here when deciding where to put capital.
//
// Dedup: same (source, instrument, side, entry_hint window) within 24h is
// treated as a refresh — we bump the row rather than inserting a duplicate.

import { db } from "@/lib/db/client"

export type AssetClass = "equity" | "crypto" | "futures" | "forex" | "options" | "prediction"
export type Side = "long" | "short"
export type OpportunityStatus = "open" | "claimed" | "executed" | "expired" | "rejected" | "muted"

export type OpportunityInput = {
  source: string                  // 'splitwatch' | 'swing' | 'jarvis' | 'trading_bot' | ...
  asset_class: AssetClass
  instrument: string              // ticker / symbol / contract
  side: Side
  thesis: string                  // short human-readable rationale
  expected_r?: number             // expected reward in R units (target / risk)
  win_prob?: number               // 0..1 estimated probability
  horizon_days?: number           // expected holding period
  entry_hint?: number
  stop_hint?: number
  size_hint?: number              // shares/contracts, optional
  confidence?: number             // 0..1 confidence from the source itself
  expires_at?: number             // ms epoch; null means no explicit expiry
  source_payload?: Record<string, unknown>  // raw JSON kept for audit
}

export type Opportunity = OpportunityInput & {
  id: string
  status: OpportunityStatus
  created_at: number
  updated_at: number
}

let tableReady = false
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      instrument TEXT NOT NULL,
      side TEXT NOT NULL,
      thesis TEXT NOT NULL,
      expected_r REAL,
      win_prob REAL,
      horizon_days INTEGER,
      entry_hint REAL,
      stop_hint REAL,
      size_hint REAL,
      confidence REAL,
      expires_at INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      source_payload_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_opp_source ON opportunities(source)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_opp_status_created ON opportunities(status, created_at DESC)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_opp_instrument ON opportunities(instrument)`)
  tableReady = true
}

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000

// Find an existing open row for the same (source, instrument, side) within 24h.
// If entry_hint is provided, the existing row's entry_hint must be within 1%
// to count as a duplicate. This avoids merging meaningfully different setups.
async function findRecentMatch(input: OpportunityInput): Promise<string | null> {
  const cutoff = Date.now() - DEDUP_WINDOW_MS
  const r = await db.execute({
    sql: `SELECT id, entry_hint FROM opportunities
          WHERE source = ? AND instrument = ? AND side = ? AND status = 'open'
            AND created_at >= ?
          ORDER BY created_at DESC LIMIT 5`,
    args: [input.source, input.instrument, input.side, cutoff],
  })
  for (const row of r.rows) {
    const r = row as unknown as { id: string; entry_hint: number | null }
    if (input.entry_hint === undefined || input.entry_hint === null) {
      // No entry hint to compare → treat any same-source same-instrument as dup
      return String(r.id)
    }
    if (r.entry_hint === null) continue
    const drift = Math.abs(input.entry_hint - r.entry_hint) / Math.max(1e-9, Math.abs(r.entry_hint))
    if (drift < 0.01) return String(r.id)
  }
  return null
}

export async function ingestOpportunity(input: OpportunityInput): Promise<{ id: string; dedup: boolean }> {
  await ensureTable()
  const now = Date.now()

  const existing = await findRecentMatch(input)
  if (existing) {
    // Refresh the existing row's data + bump updated_at.
    await db.execute({
      sql: `UPDATE opportunities
            SET thesis = ?, expected_r = ?, win_prob = ?, horizon_days = ?,
                entry_hint = ?, stop_hint = ?, size_hint = ?, confidence = ?,
                expires_at = ?, source_payload_json = ?, updated_at = ?
            WHERE id = ?`,
      args: [
        input.thesis,
        input.expected_r ?? null,
        input.win_prob ?? null,
        input.horizon_days ?? null,
        input.entry_hint ?? null,
        input.stop_hint ?? null,
        input.size_hint ?? null,
        input.confidence ?? null,
        input.expires_at ?? null,
        input.source_payload ? JSON.stringify(input.source_payload) : null,
        now,
        existing,
      ],
    })
    return { id: existing, dedup: true }
  }

  const id = `opp_${now}_${Math.random().toString(36).slice(2, 8)}`
  await db.execute({
    sql: `INSERT INTO opportunities
            (id, source, asset_class, instrument, side, thesis,
             expected_r, win_prob, horizon_days, entry_hint, stop_hint,
             size_hint, confidence, expires_at, status, source_payload_json,
             created_at, updated_at)
          VALUES (?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,'open',?, ?,?)`,
    args: [
      id,
      input.source,
      input.asset_class,
      input.instrument,
      input.side,
      input.thesis,
      input.expected_r ?? null,
      input.win_prob ?? null,
      input.horizon_days ?? null,
      input.entry_hint ?? null,
      input.stop_hint ?? null,
      input.size_hint ?? null,
      input.confidence ?? null,
      input.expires_at ?? null,
      input.source_payload ? JSON.stringify(input.source_payload) : null,
      now,
      now,
    ],
  })
  return { id, dedup: false }
}

export type ListFilters = {
  source?: string
  status?: OpportunityStatus
  asset_class?: AssetClass
  instrument?: string
  limit?: number
}

function rowToOpportunity(row: Record<string, unknown>): Opportunity {
  let payload: Record<string, unknown> | undefined
  if (row.source_payload_json) {
    try { payload = JSON.parse(String(row.source_payload_json)) } catch { /* invalid */ }
  }
  return {
    id: String(row.id),
    source: String(row.source),
    asset_class: String(row.asset_class) as AssetClass,
    instrument: String(row.instrument),
    side: String(row.side) as Side,
    thesis: String(row.thesis),
    expected_r: row.expected_r === null ? undefined : Number(row.expected_r),
    win_prob: row.win_prob === null ? undefined : Number(row.win_prob),
    horizon_days: row.horizon_days === null ? undefined : Number(row.horizon_days),
    entry_hint: row.entry_hint === null ? undefined : Number(row.entry_hint),
    stop_hint: row.stop_hint === null ? undefined : Number(row.stop_hint),
    size_hint: row.size_hint === null ? undefined : Number(row.size_hint),
    confidence: row.confidence === null ? undefined : Number(row.confidence),
    expires_at: row.expires_at === null ? undefined : Number(row.expires_at),
    source_payload: payload,
    status: String(row.status) as OpportunityStatus,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }
}

export async function listOpportunities(filters: ListFilters = {}): Promise<Opportunity[]> {
  await ensureTable()
  const where: string[] = []
  const args: unknown[] = []
  if (filters.source)      { where.push("source = ?");      args.push(filters.source) }
  if (filters.status)      { where.push("status = ?");      args.push(filters.status) }
  if (filters.asset_class) { where.push("asset_class = ?"); args.push(filters.asset_class) }
  if (filters.instrument)  { where.push("instrument = ?");  args.push(filters.instrument) }
  const limit = Math.min(500, Math.max(1, filters.limit ?? 100))
  args.push(limit)
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const r = await db.execute({
    sql: `SELECT * FROM opportunities ${whereSql} ORDER BY created_at DESC LIMIT ?`,
    args: args as never,
  })
  return r.rows.map(row => rowToOpportunity(row as unknown as Record<string, unknown>))
}

export async function updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<void> {
  await ensureTable()
  await db.execute({
    sql: `UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?`,
    args: [status, Date.now(), id],
  })
}

export async function expireOpportunities(): Promise<{ expired: number }> {
  await ensureTable()
  const now = Date.now()
  const r = await db.execute({
    sql: `UPDATE opportunities SET status = 'expired', updated_at = ?
          WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at < ?`,
    args: [now, now],
  })
  return { expired: Number(r.rowsAffected ?? 0) }
}
