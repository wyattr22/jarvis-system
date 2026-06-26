// Cosine-similarity retrieval against pre-computed embeddings in Turso.
// Falls back to keyword search if embeddings aren't available or the model fails to load.

import { db } from "@/lib/db/client"
import { embed, cosine, bufferToFloatArray } from "@/lib/semantic/embed"

type RankedChunk = { source: string; content: string; score: number }

// Ensure the schema is migrated. Safe to call repeatedly.
let schemaReady = false
export async function ensureSemanticSchema(): Promise<void> {
  if (schemaReady) return
  try {
    await db.execute(`ALTER TABLE research_chunks ADD COLUMN embedding BLOB`)
  } catch { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE jarvis_memory ADD COLUMN embedding BLOB`)
  } catch { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE jarvis_memory ADD COLUMN low_confidence INTEGER DEFAULT 0`)
  } catch { /* already exists */ }
  schemaReady = true
}

// TF-IDF scoring — rare terms get a much higher weight than common ones.
// This is the always-available fallback when embeddings aren't ready.
function extractTerms(query: string): string[] {
  return query.toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 3)
    .map(t => t.replace(/[^a-z]/g, ''))
    .filter(Boolean)
}

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3)
}

// Compute IDF (log scaling) over the corpus for the queried terms, then rank
// each chunk by sum of (tf × idf) for its overlap with the query.
function tfIdfRank<T extends { content: string }>(
  query: string,
  candidates: T[],
  limit: number,
): (T & { score: number })[] {
  const terms = extractTerms(query)
  if (!terms.length || !candidates.length) return []
  const N = candidates.length

  // Document frequency for each query term
  const tokenized = candidates.map(c => new Set(tokenize(c.content)))
  const df: Record<string, number> = {}
  for (const t of terms) {
    df[t] = tokenized.reduce((n, set) => n + (set.has(t) ? 1 : 0), 0)
  }
  const idf: Record<string, number> = {}
  for (const t of terms) {
    idf[t] = Math.log(1 + N / (1 + df[t]))  // smoothed IDF
  }

  return candidates
    .map((c, i) => {
      const tokens = tokenize(c.content)
      const tf: Record<string, number> = {}
      for (const tok of tokens) tf[tok] = (tf[tok] ?? 0) + 1
      const len = Math.max(50, tokens.length)
      let score = 0
      for (const t of terms) {
        const f = tf[t] ?? 0
        if (f > 0) score += (f / len) * idf[t]
      }
      return { ...c, score, _idx: i }
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// Semantic search over research_chunks. Returns formatted block ready for LLM context.
export async function semanticSearchResearch(query: string, limit = 3): Promise<string> {
  try {
    await ensureSemanticSchema()
    if (!query.trim()) return ""

    const rows = await db.execute({
      sql: `SELECT source_name, chunk_index, content, embedding FROM research_chunks ORDER BY created_at DESC LIMIT 600`,
      args: [],
    })
    if (!rows.rows.length) return ""

    // Try semantic ranking first
    let scored: RankedChunk[] = []
    try {
      const queryEmb = await embed(query)
      const withEmbed = rows.rows.filter(r => r.embedding !== null && r.embedding !== undefined)

      if (withEmbed.length > 0) {
        scored = withEmbed.map(r => {
          const emb = bufferToFloatArray(r.embedding as any)
          return {
            source: String(r.source_name),
            content: String(r.content),
            score: cosine(queryEmb, emb),
          }
        })
          .filter(r => r.score > 0.2)  // weak matches add noise
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
      }
    } catch (err) {
      console.warn('[semantic] embed failed, falling back to keyword:', String(err))
    }

    // Fallback: TF-IDF (covers cold-start when nothing is embedded yet)
    if (scored.length === 0) {
      const candidates = rows.rows.map(r => ({
        source: String(r.source_name),
        content: String(r.content),
      }))
      scored = tfIdfRank(query, candidates, limit).map(r => ({
        source: r.source,
        content: r.content,
        score: r.score,
      }))
    }

    if (!scored.length) return ""
    const lines = scored.map(r => `[RESEARCH: ${r.source}]\n${r.content}`)
    return `RELEVANT RESEARCH:\n${lines.join("\n\n---\n\n")}`
  } catch {
    return ""
  }
}

// Semantic ranking for memories. Receives candidate memory rows that already
// passed importance/ticker filters; returns top-N by semantic similarity to query.
export async function semanticRankMemories<
  T extends { id: string; content: string; embedding?: Buffer | Uint8Array | null }
>(query: string, candidates: T[], limit = 5): Promise<T[]> {
  if (candidates.length <= limit) return candidates
  if (!query.trim()) return candidates.slice(0, limit)
  try {
    const queryEmb = await embed(query)
    const withEmbed = candidates.filter(c => c.embedding)
    if (withEmbed.length === 0) return candidates.slice(0, limit)
    const scored = withEmbed.map(c => ({
      mem: c,
      score: cosine(queryEmb, bufferToFloatArray(c.embedding as any)),
    }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    return scored.map(s => s.mem)
  } catch {
    return candidates.slice(0, limit)
  }
}
