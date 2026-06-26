import { getAllMemories, saveMemory, deleteMemory, updateMemory } from "@/lib/memory/store"
import { db } from "@/lib/db/client"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit") ?? 2000)))
  const memories = await getAllMemories(limit)
  // Total count so the UI can show "showing N of M"
  let total = memories.length
  try {
    const r = await db.execute("SELECT COUNT(*) as n FROM jarvis_memory")
    total = Number((r.rows[0] as any)?.n ?? memories.length)
  } catch { /* ignore */ }
  return Response.json({ memories, total, limit })
}

export async function POST(req: Request) {
  const { content, type, tags, importance } = await req.json()
  if (!content || !type) return Response.json({ error: "content and type required" }, { status: 400 })
  const id = await saveMemory(content, type, { tags, importance, source: "user_said" })
  return Response.json({ ok: true, id })
}

export async function PATCH(req: Request) {
  const { id, content, importance } = await req.json()
  if (!id) return Response.json({ error: "id required" }, { status: 400 })
  await updateMemory(id, content, importance)
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { id } = await req.json()
  if (!id) return Response.json({ error: "id required" }, { status: 400 })
  await deleteMemory(id)
  return Response.json({ ok: true })
}
