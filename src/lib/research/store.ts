import { db } from "@/lib/db/client"
import { embedBatch, floatArrayToBuffer } from "@/lib/semantic/embed"
import { semanticSearchResearch, ensureSemanticSchema } from "@/lib/semantic"

async function ensureTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_chunks (
      id TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  await ensureSemanticSchema()
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_research_source ON research_chunks (source_name)
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      chunk_count INTEGER DEFAULT 0,
      brief TEXT,
      created_at INTEGER NOT NULL
    )
  `)
}

const CHUNK_SIZE  = 1800  // ~450 tokens
const CHUNK_OVERLAP = 150

function chunkText(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  const chunks: string[] = []
  let start = 0
  while (start < cleaned.length) {
    const end = Math.min(start + CHUNK_SIZE, cleaned.length)
    const chunk = cleaned.slice(start, end).trim()
    if (chunk.length > 80) chunks.push(chunk)
    if (end >= cleaned.length) break
    start = end - CHUNK_OVERLAP
  }
  return chunks
}

export async function ingestResearch(
  sourceName: string,
  content: string,
  brief?: string
): Promise<{ chunks: number }> {
  await ensureTable()

  const chunks = chunkText(content)
  const now = Date.now()

  // Remove prior chunks for this source so re-ingesting is idempotent
  await db.execute({ sql: "DELETE FROM research_chunks WHERE source_name = ?", args: [sourceName] })

  // Embed chunks in one batch so semantic search works as soon as ingestion completes.
  // If embeddings fail (e.g. model download issue), we still write the chunks — keyword
  // search will cover them and the backfill script can fill in embeddings later.
  let embeddings: Buffer[] = []
  try {
    const vecs = await embedBatch(chunks)
    embeddings = vecs.map(floatArrayToBuffer)
  } catch (err) {
    console.warn('[research] embedding failed during ingest, will rely on keyword search:', String(err))
  }

  for (let i = 0; i < chunks.length; i++) {
    const id = `rc_${now}_${i}`
    await db.execute({
      sql: "INSERT INTO research_chunks (id, source_name, chunk_index, content, created_at, embedding) VALUES (?,?,?,?,?,?)",
      args: [id, sourceName, i, chunks[i], now, embeddings[i] ?? null],
    })
  }

  const sourceId = `rs_${sourceName.slice(0, 30).replace(/[^a-z0-9]/gi, '_')}`
  await db.execute({
    sql: `INSERT INTO research_sources (id, name, chunk_count, brief, created_at)
          VALUES (?,?,?,?,?)
          ON CONFLICT(name) DO UPDATE SET chunk_count=?, brief=COALESCE(?,brief), created_at=?`,
    args: [sourceId, sourceName, chunks.length, brief ?? null, now, chunks.length, brief ?? null, now],
  })

  return { chunks: chunks.length }
}

// Semantic retrieval (with keyword fallback) — returns top chunks for the query
export async function searchResearch(query: string, limit = 3): Promise<string> {
  // Semantic path with built-in keyword fallback
  try {
    const result = await semanticSearchResearch(query, limit)
    if (result) return result
  } catch { /* fall through to legacy keyword */ }
  return searchResearchKeyword(query, limit)
}

// Original keyword-only implementation, kept as ultimate fallback
async function searchResearchKeyword(query: string, limit = 3): Promise<string> {
  try {
    await ensureTable()
    if (!query.trim()) return ""

    // Score ALL chunks against query terms (limited to 600 most recent for speed)
    const result = await db.execute({
      sql: "SELECT source_name, chunk_index, content FROM research_chunks ORDER BY created_at DESC LIMIT 600",
      args: [],
    })
    if (!result.rows.length) return ""

    const terms = query.toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 3)
      .map(t => t.replace(/[^a-z]/g, ''))
      .filter(Boolean)

    if (!terms.length) return ""

    const scored = result.rows
      .map(r => {
        const text = String(r.content).toLowerCase()
        const score = terms.reduce((s, t) => {
          const matches = text.split(t).length - 1
          return s + matches
        }, 0)
        return { source: String(r.source_name), idx: Number(r.chunk_index), content: String(r.content), score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    if (!scored.length) return ""

    const lines = scored.map(r => `[RESEARCH: ${r.source}]\n${r.content}`)
    return `RELEVANT RESEARCH:\n${lines.join("\n\n---\n\n")}`
  } catch {
    return ""
  }
}

export async function listResearchSources(): Promise<{ name: string; chunks: number; brief: string | null; createdAt: number }[]> {
  try {
    await ensureTable()
    const result = await db.execute(
      "SELECT name, chunk_count, brief, created_at FROM research_sources ORDER BY created_at DESC"
    )
    return result.rows.map(r => ({
      name:      String(r.name),
      chunks:    Number(r.chunk_count),
      brief:     r.brief ? String(r.brief) : null,
      createdAt: Number(r.created_at),
    }))
  } catch {
    return []
  }
}
