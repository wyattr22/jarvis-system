import { db } from "@/lib/db/client"
import { embed, floatArrayToBuffer } from "@/lib/semantic/embed"
import { semanticRankMemories, ensureSemanticSchema } from "@/lib/semantic"

export type MemoryType = "fact" | "insight" | "pattern" | "preference" | "correction"

export interface Memory {
  id: string
  type: MemoryType
  content: string          // markdown-formatted
  tags: string[]           // tickers, topics
  importance: number       // 1–10
  source: "user_said" | "jarvis_observed" | "system"
  created_at: number
  last_accessed: number
  access_count: number
}

async function ensureTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS jarvis_memory (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      importance INTEGER NOT NULL DEFAULT 5,
      source TEXT NOT NULL DEFAULT 'jarvis_observed',
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0
    )
  `)
  // Migrations for semantic search + correction tracking
  await ensureSemanticSchema()
}

export async function saveMemory(
  content: string,
  type: MemoryType,
  options: {
    tags?: string[]
    importance?: number
    source?: Memory["source"]
  } = {}
): Promise<string> {
  await ensureTable()
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const now = Date.now()

  // Embed on save so semantic retrieval works immediately. Non-blocking on failure.
  let embedding: Buffer | null = null
  try {
    const vec = await embed(content.trim())
    embedding = floatArrayToBuffer(vec)
  } catch { /* fall back to keyword retrieval */ }

  await db.execute({
    sql: `INSERT INTO jarvis_memory (id, type, content, tags, importance, source, created_at, last_accessed, access_count, embedding)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    args: [
      id,
      type,
      content.trim(),
      JSON.stringify(options.tags ?? []),
      options.importance ?? 5,
      options.source ?? "jarvis_observed",
      now,
      now,
      embedding,
    ],
  })
  return id
}

// Mark a memory as low-confidence (set by correction-detection loop).
// The retrieval path excludes low-confidence rows from the always-pinned set.
export async function markMemoryLowConfidence(id: string, importanceDelta = -2): Promise<void> {
  await ensureTable()
  await db.execute({
    sql: `UPDATE jarvis_memory SET low_confidence = 1, importance = MAX(1, importance + ?) WHERE id = ?`,
    args: [importanceDelta, id],
  })
}

export async function updateMemory(id: string, content: string, importance?: number) {
  await ensureTable()
  await db.execute({
    sql: `UPDATE jarvis_memory SET content = ?, importance = COALESCE(?, importance), last_accessed = ? WHERE id = ?`,
    args: [content, importance ?? null, Date.now(), id],
  })
}

export async function deleteMemory(id: string) {
  await ensureTable()
  await db.execute({ sql: "DELETE FROM jarvis_memory WHERE id = ?", args: [id] })
}

export async function getRelevantMemories(
  tickers: string[],
  query: string,
  limit = 12
): Promise<Memory[]> {
  await ensureTable()

  const rows: (Memory & { embedding?: Uint8Array | null })[] = []

  // Fetch high-importance memories (always included). Exclude low_confidence.
  const pinned = await db.execute({
    sql: `SELECT * FROM jarvis_memory WHERE importance >= 8 AND COALESCE(low_confidence, 0) = 0 ORDER BY last_accessed DESC LIMIT 6`,
    args: [],
  })
  rows.push(...pinned.rows.map(rowToMemoryWithEmbed))

  // Fetch ticker-tagged memories
  if (tickers.length) {
    for (const ticker of tickers.slice(0, 3)) {
      const tagged = await db.execute({
        sql: `SELECT * FROM jarvis_memory WHERE tags LIKE ? AND COALESCE(low_confidence, 0) = 0 ORDER BY importance DESC, last_accessed DESC LIMIT 6`,
        args: [`%"${ticker}"%`],
      })
      rows.push(...tagged.rows.map(rowToMemoryWithEmbed))
    }
  }

  // Fetch recent memories regardless of tag
  const recent = await db.execute({
    sql: `SELECT * FROM jarvis_memory WHERE COALESCE(low_confidence, 0) = 0 ORDER BY last_accessed DESC LIMIT 12`,
    args: [],
  })
  rows.push(...recent.rows.map(rowToMemoryWithEmbed))

  // Deduplicate
  const seen = new Set<string>()
  const deduped = rows.filter(m => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  // Semantic rerank (falls back to first-N when embeddings are missing)
  const ranked = await semanticRankMemories(query, deduped, limit)

  // Touch access stats on the ones we're returning
  const ids = ranked.map(m => m.id)
  if (ids.length) {
    await db.execute({
      sql: `UPDATE jarvis_memory SET last_accessed = ?, access_count = access_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
      args: [Date.now(), ...ids],
    })
  }

  // Strip embedding before returning so it doesn't leak to callers
  return ranked.map(({ embedding: _e, ...m }) => m as Memory)
}

export async function getAllMemories(limit = 100): Promise<Memory[]> {
  await ensureTable()
  const result = await db.execute({
    sql: `SELECT * FROM jarvis_memory ORDER BY importance DESC, last_accessed DESC LIMIT ?`,
    args: [limit],
  })
  return result.rows.map(rowToMemory)
}

function rowToMemory(row: Record<string, unknown>): Memory {
  let tags: string[] = []
  try { tags = JSON.parse(row.tags as string) } catch { /* ignore */ }
  return {
    id: row.id as string,
    type: row.type as MemoryType,
    content: row.content as string,
    tags,
    importance: row.importance as number,
    source: row.source as Memory["source"],
    created_at: row.created_at as number,
    last_accessed: row.last_accessed as number,
    access_count: row.access_count as number,
  }
}

function rowToMemoryWithEmbed(row: Record<string, unknown>): Memory & { embedding?: Uint8Array | null } {
  const m = rowToMemory(row)
  const emb = row.embedding
  return { ...m, embedding: (emb as Uint8Array) ?? null }
}
