import { db } from "@/lib/db/client"

async function ensureTable() {
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

export async function GET() {
  await ensureTable()
  const result = await db.execute({
    sql: `SELECT instrument, added_by, reason, pattern_json, lift, p_value, created_at
          FROM watchlist
          ORDER BY created_at DESC`,
    args: [],
  })
  return Response.json({ watchlist: result.rows })
}

export async function POST(req: Request) {
  await ensureTable()
  const { instrument, addedBy, reason, patternJson, lift, pValue } = await req.json()
  if (!instrument || !addedBy) {
    return Response.json({ error: "instrument and addedBy required" }, { status: 400 })
  }

  await db.execute({
    sql: `INSERT OR REPLACE INTO watchlist (instrument, added_by, reason, pattern_json, lift, p_value, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      instrument.toUpperCase(),
      addedBy,
      reason ?? null,
      patternJson ? JSON.stringify(patternJson) : null,
      lift ?? null,
      pValue ?? null,
      Date.now(),
    ],
  })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  await ensureTable()
  const { instrument } = await req.json()
  await db.execute({ sql: "DELETE FROM watchlist WHERE instrument = ?", args: [instrument] })
  return Response.json({ ok: true })
}
