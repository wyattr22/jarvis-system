// Backfill embeddings for existing research_chunks + jarvis_memory rows.
// Designed to be invoked repeatedly — each call processes a batch and reports
// remaining work. Stops when nothing left.
//
//   GET /api/admin/backfill-embeddings?table=research_chunks&limit=200
//   GET /api/admin/backfill-embeddings?table=jarvis_memory&limit=100
//
// Auth: Bearer CRON_SECRET

import { db } from "@/lib/db/client"
import { embedBatch, floatArrayToBuffer } from "@/lib/semantic/embed"
import { ensureSemanticSchema } from "@/lib/semantic"

export const maxDuration = 300  // Vercel max for hobby plan

function unauthorized() {
  return new Response("Unauthorized", { status: 401 })
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? ""
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return unauthorized()

  const url = new URL(req.url)
  const table = url.searchParams.get("table") ?? "research_chunks"
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)))

  if (table !== "research_chunks" && table !== "jarvis_memory") {
    return Response.json({ error: "table must be research_chunks or jarvis_memory" }, { status: 400 })
  }

  await ensureSemanticSchema()

  const remainingQ = await db.execute(`SELECT COUNT(*) as n FROM ${table} WHERE embedding IS NULL`)
  const remaining = Number((remainingQ.rows[0] as any).n)

  if (remaining === 0) {
    return Response.json({ ok: true, done: true, remaining: 0, processed: 0 })
  }

  // Pull a batch to process
  const idCol = "id"
  const contentCol = "content"
  const batch = await db.execute({
    sql: `SELECT ${idCol}, ${contentCol} FROM ${table} WHERE embedding IS NULL LIMIT ?`,
    args: [limit],
  })

  const ids: string[] = batch.rows.map(r => String((r as any)[idCol]))
  const texts: string[] = batch.rows.map(r => String((r as any)[contentCol]))

  const t0 = Date.now()
  let processed = 0
  let failed = 0
  try {
    const vecs = await embedBatch(texts)
    for (let i = 0; i < ids.length; i++) {
      try {
        await db.execute({
          sql: `UPDATE ${table} SET embedding = ? WHERE ${idCol} = ?`,
          args: [floatArrayToBuffer(vecs[i]), ids[i]],
        })
        processed++
      } catch { failed++ }
    }
  } catch (err) {
    return Response.json({
      ok: false,
      error: `embedBatch failed: ${String(err)}`,
      remaining,
    }, { status: 500 })
  }

  const elapsedMs = Date.now() - t0
  const newRemaining = remaining - processed

  return Response.json({
    ok: true,
    done: newRemaining === 0,
    table,
    processed,
    failed,
    remaining: newRemaining,
    elapsedMs,
    next: newRemaining > 0
      ? `${url.origin}/api/admin/backfill-embeddings?table=${table}&limit=${limit}`
      : null,
  })
}
