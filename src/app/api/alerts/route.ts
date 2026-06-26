import { db } from "@/lib/db/client"

export async function GET() {
  const result = await db.execute({
    sql: `SELECT id, instrument, rule_type, rule_json, active, triggered_at, created_at
          FROM alerts ORDER BY created_at DESC LIMIT 100`,
    args: [],
  })
  return Response.json({ alerts: result.rows })
}

export async function POST(req: Request) {
  const { symbol, condition, threshold, message } = await req.json()
  if (!symbol || !condition || threshold === undefined) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await db.execute({
    sql: `INSERT INTO alerts (id, instrument, rule_type, rule_json, active, created_at)
          VALUES (?, ?, ?, ?, 1, ?)`,
    args: [
      id,
      symbol,
      condition,
      JSON.stringify({ threshold, message }),
      Date.now(),
    ],
  })

  return Response.json({ ok: true, id })
}

export async function DELETE(req: Request) {
  const { id } = await req.json()
  await db.execute({ sql: "DELETE FROM alerts WHERE id = ?", args: [id] })
  return Response.json({ ok: true })
}
