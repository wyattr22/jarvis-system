// Cron version of the embeddings backfill. Processes a small batch each run
// so the work spreads across hours instead of one giant 12-minute admin call.
// Stops as soon as no rows missing embeddings remain.

import { db } from "@/lib/db/client"
import { embedBatch, floatArrayToBuffer } from "@/lib/semantic/embed"
import { ensureSemanticSchema } from "@/lib/semantic"

export const maxDuration = 60
const BATCH_SIZE = 40  // ~2s of embedding work + DB writes

async function backfillTable(table: "research_chunks" | "jarvis_memory"): Promise<{
  table: string
  processed: number
  remaining: number
  done: boolean
}> {
  const remainingQ = await db.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE embedding IS NULL`)
  const remaining = Number((remainingQ.rows[0] as any).n)
  if (remaining === 0) {
    return { table, processed: 0, remaining: 0, done: true }
  }

  const batch = await db.execute({
    sql: `SELECT id, content FROM ${table} WHERE embedding IS NULL LIMIT ?`,
    args: [BATCH_SIZE],
  })

  const ids = batch.rows.map(r => String((r as any).id))
  const texts = batch.rows.map(r => String((r as any).content))

  let processed = 0
  try {
    const vecs = await embedBatch(texts)
    for (let i = 0; i < ids.length; i++) {
      try {
        await db.execute({
          sql: `UPDATE ${table} SET embedding = ? WHERE id = ?`,
          args: [floatArrayToBuffer(vecs[i]), ids[i]],
        })
        processed++
      } catch { /* skip row on insert error */ }
    }
  } catch {
    // Embedder fell over (e.g. Transformers.js cold-start issue) — bail
    // for this run, try again next cron tick.
    return { table, processed: 0, remaining, done: false }
  }

  return { table, processed, remaining: remaining - processed, done: remaining - processed === 0 }
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  await ensureSemanticSchema()

  // Do research_chunks first (larger corpus), then memories
  const research = await backfillTable("research_chunks")
  // If research still has work, skip memories this tick to stay under timeout
  const memories = research.done
    ? await backfillTable("jarvis_memory")
    : { table: "jarvis_memory", processed: 0, remaining: -1, done: false }

  return Response.json({
    ok: true,
    research,
    memories,
    ts: Date.now(),
  })
}
