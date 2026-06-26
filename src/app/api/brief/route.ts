import { db } from "@/lib/db/client"

async function ensureBriefsTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS morning_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

export async function GET() {
  await ensureBriefsTable()
  const today = new Date().toISOString().slice(0, 10)
  try {
    const res = await db.execute({
      sql: "SELECT content, created_at FROM morning_briefs WHERE date = ? ORDER BY created_at DESC LIMIT 1",
      args: [today],
    })
    if (!res.rows.length) return Response.json({ brief: null })
    return Response.json({ brief: res.rows[0].content, created_at: res.rows[0].created_at })
  } catch {
    return Response.json({ brief: null })
  }
}
