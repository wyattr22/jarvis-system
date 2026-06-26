import { db } from "@/lib/db/client"

const HOLDOUT_PCT = 0.20

export async function getHoldoutBoundary(): Promise<number> {
  const row = await db.execute("SELECT boundary_timestamp FROM holdout_config WHERE id = 1")
  if (row.rows.length > 0) return row.rows[0].boundary_timestamp as number

  // First run: compute boundary from existing trades
  const result = await db.execute(
    "SELECT MIN(opened_at) as minT, MAX(opened_at) as maxT FROM trades WHERE opened_at IS NOT NULL"
  )
  const minT = result.rows[0]?.minT as number ?? Date.now() - 365 * 86400000
  const maxT = result.rows[0]?.maxT as number ?? Date.now()
  const boundary = Math.floor(minT + (maxT - minT) * (1 - HOLDOUT_PCT))

  await db.execute({
    sql: "INSERT OR REPLACE INTO holdout_config (id, boundary_timestamp, updated_at) VALUES (1, ?, ?)",
    args: [boundary, Date.now()],
  })
  return boundary
}

export async function refreshHoldoutBoundary(): Promise<number> {
  const result = await db.execute(
    "SELECT MIN(opened_at) as minT, MAX(opened_at) as maxT FROM trades WHERE opened_at IS NOT NULL"
  )
  const minT = result.rows[0]?.minT as number ?? Date.now() - 365 * 86400000
  const maxT = result.rows[0]?.maxT as number ?? Date.now()
  const boundary = Math.floor(minT + (maxT - minT) * (1 - HOLDOUT_PCT))

  await db.execute({
    sql: "INSERT OR REPLACE INTO holdout_config (id, boundary_timestamp, updated_at) VALUES (1, ?, ?)",
    args: [boundary, Date.now()],
  })
  return boundary
}

export function isInHoldout(timestamp: number, boundary: number): boolean {
  return timestamp > boundary
}
