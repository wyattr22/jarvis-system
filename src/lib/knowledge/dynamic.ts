import { db } from "@/lib/db/client"

async function ensureTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      source TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL
    )
  `)
}

export async function saveKnowledgeEntry(content: string, category = "general"): Promise<string> {
  await ensureTable()
  const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  await db.execute({
    sql: "INSERT INTO knowledge_entries (id, content, category, source, created_at) VALUES (?, ?, ?, 'user', ?)",
    args: [id, content.trim(), category, Date.now()],
  })
  return id
}

export async function getDynamicKnowledge(): Promise<string> {
  try {
    await ensureTable()
    const result = await db.execute({
      sql: "SELECT content, category FROM knowledge_entries ORDER BY created_at DESC LIMIT 50",
      args: [],
    })
    if (!result.rows.length) return ""
    const lines = result.rows.map(r => `[${String(r.category).toUpperCase()}] ${r.content}`)
    return `USER-RECORDED KNOWLEDGE:\n${lines.join("\n")}`
  } catch {
    return ""
  }
}
