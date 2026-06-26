import { createClient } from "@libsql/client"

const url = process.env.TURSO_DATABASE_URL ?? "file:./jarvis.db"
const authToken = process.env.TURSO_AUTH_TOKEN || undefined

export const db = createClient({ url, authToken })

export async function getHoldoutBoundary(): Promise<number> {
  const row = await db.execute("SELECT boundary_timestamp FROM holdout_config WHERE id = 1")
  if (row.rows.length === 0) return 0
  return row.rows[0].boundary_timestamp as number
}
