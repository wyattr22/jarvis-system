// allocations table — every executed allocation lands here for audit + the
// proposal-outcomes tracker to reason against later.

import { db } from "@/lib/db/client"

export type DecidedBy = "user" | "auto" | "council"

export type AllocationRow = {
  id: string
  opportunity_id: string
  broker: string
  order_id: string | null
  allocated_usd: number
  risk_per_trade_pct: number
  decided_by: DecidedBy
  decided_at: number
  status: "submitted" | "filled" | "rejected" | "error"
  error?: string | null
}

let tableReady = false
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS allocations (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      broker TEXT NOT NULL,
      order_id TEXT,
      allocated_usd REAL NOT NULL,
      risk_per_trade_pct REAL NOT NULL,
      decided_by TEXT NOT NULL,
      decided_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_alloc_opp ON allocations(opportunity_id)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_alloc_decided_at ON allocations(decided_at DESC)`)
  tableReady = true
}

export async function recordAllocation(input: Omit<AllocationRow, "id" | "decided_at"> & { decided_at?: number }): Promise<string> {
  await ensureTable()
  const id = `alloc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const decided_at = input.decided_at ?? Date.now()
  await db.execute({
    sql: `INSERT INTO allocations
            (id, opportunity_id, broker, order_id, allocated_usd, risk_per_trade_pct, decided_by, decided_at, status, error)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.opportunity_id,
      input.broker,
      input.order_id,
      input.allocated_usd,
      input.risk_per_trade_pct,
      input.decided_by,
      decided_at,
      input.status,
      input.error ?? null,
    ],
  })
  return id
}

export async function listAllocations(limit = 100): Promise<AllocationRow[]> {
  await ensureTable()
  const r = await db.execute({
    sql: `SELECT * FROM allocations ORDER BY decided_at DESC LIMIT ?`,
    args: [Math.min(500, Math.max(1, limit))],
  })
  return r.rows.map(row => row as unknown as AllocationRow)
}
