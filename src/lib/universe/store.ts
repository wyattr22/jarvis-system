// scan_universe — the rotating symbol base (12.3). One row per symbol that
// survived the whole-market scan; replaced wholesale on each scan so the
// universe rotates with the tape instead of being a hardcoded list.

import { db } from "@/lib/db/client"

export interface UniverseRow {
  symbol: string
  rank: number
  score: number
  price: number
  dollar_volume: number
  atr_pct: number
  change_pct: number
  reason: string
  scanned_at: number
}

let tableEnsured = false
async function ensureTable(): Promise<void> {
  if (tableEnsured) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS scan_universe (
      symbol TEXT PRIMARY KEY,
      rank INTEGER NOT NULL,
      score REAL NOT NULL,
      price REAL NOT NULL,
      dollar_volume REAL NOT NULL,
      atr_pct REAL NOT NULL,
      change_pct REAL NOT NULL,
      reason TEXT NOT NULL,
      scanned_at INTEGER NOT NULL
    )
  `)
  tableEnsured = true
}

export async function replaceUniverse(rows: Omit<UniverseRow, "scanned_at">[]): Promise<void> {
  await ensureTable()
  const now = Date.now()
  await db.execute("DELETE FROM scan_universe")
  for (const r of rows) {
    await db.execute({
      sql: `INSERT INTO scan_universe (symbol, rank, score, price, dollar_volume, atr_pct, change_pct, reason, scanned_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [r.symbol, r.rank, r.score, r.price, r.dollar_volume, r.atr_pct, r.change_pct, r.reason, now],
    })
  }
}

/** Top-N symbols from the latest scan (rank order). Empty if never scanned. */
export async function getUniverseSymbols(limit = 150): Promise<string[]> {
  await ensureTable()
  const res = await db.execute({
    sql: "SELECT symbol FROM scan_universe ORDER BY rank ASC LIMIT ?",
    args: [limit],
  })
  return res.rows.map(r => String(r.symbol))
}

export async function getUniverseRows(limit = 150): Promise<UniverseRow[]> {
  await ensureTable()
  const res = await db.execute({
    sql: "SELECT * FROM scan_universe ORDER BY rank ASC LIMIT ?",
    args: [limit],
  })
  return res.rows.map(r => ({
    symbol: String(r.symbol),
    rank: Number(r.rank),
    score: Number(r.score),
    price: Number(r.price),
    dollar_volume: Number(r.dollar_volume),
    atr_pct: Number(r.atr_pct),
    change_pct: Number(r.change_pct),
    reason: String(r.reason),
    scanned_at: Number(r.scanned_at),
  }))
}

// Legacy fallback when no scan has run yet — the old hardcoded strategy list.
export const LEGACY_UNIVERSE = [
  "RIOT", "MARA", "HUT", "RCAT", "IONQ", "TSLA", "UVXY", "HOOD", "SNAP", "ALAB", "AAOI", "CRDO",
]

/** Universe with fallback: scan results if present, else the legacy 12. */
export async function getActiveUniverse(limit = 150): Promise<string[]> {
  try {
    const scanned = await getUniverseSymbols(limit)
    if (scanned.length >= 10) return scanned
  } catch { /* fall through */ }
  return LEGACY_UNIVERSE
}
