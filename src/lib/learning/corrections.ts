// Detects when the user is correcting Jarvis's previous answer.
// If the previous response cited specific memories, those get demoted
// (low_confidence=1 + importance -= 2) and the correction text becomes a
// high-importance correction memory so it surfaces next time.

import { db } from "@/lib/db/client"
import { saveMemory, markMemoryLowConfidence } from "@/lib/memory/store"

const CORRECTION_RX = /^\s*(no[,\s.!]|wrong\b|that'?s\s+(wrong|not|incorrect)|actually,?\s|not\s+quite|incorrect\b|nope\b|that'?s\s+false|nah\b|you'?re\s+wrong)/i

// Cheap regex pass first. Returns true for clear corrections.
export function isObviousCorrection(text: string): boolean {
  return CORRECTION_RX.test(text)
}

let turnTableReady = false
async function ensureTurnTable(): Promise<void> {
  if (turnTableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS voice_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      query TEXT NOT NULL,
      response TEXT,
      memory_ids TEXT NOT NULL DEFAULT '[]'
    )
  `)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_voice_turns_ts ON voice_turns(ts DESC)`)
  turnTableReady = true
}

// Record a completed Jarvis turn so the next user message can be analysed for corrections.
export async function recordTurn(query: string, response: string, memoryIds: string[]): Promise<void> {
  try {
    await ensureTurnTable()
    await db.execute({
      sql: `INSERT INTO voice_turns (ts, query, response, memory_ids) VALUES (?,?,?,?)`,
      args: [Date.now(), query.slice(0, 1000), response.slice(0, 4000), JSON.stringify(memoryIds.slice(0, 12))],
    })
  } catch { /* logging is best-effort */ }
}

// Returns the most recent prior turn for the same session (we use last-5-min as session proxy).
export async function getLastTurn(): Promise<{ query: string; response: string; memoryIds: string[]; ts: number } | null> {
  try {
    await ensureTurnTable()
    const cutoff = Date.now() - 5 * 60 * 1000
    const r = await db.execute({
      sql: `SELECT ts, query, response, memory_ids FROM voice_turns WHERE ts >= ? ORDER BY ts DESC LIMIT 1`,
      args: [cutoff],
    })
    if (!r.rows.length) return null
    const row = r.rows[0] as any
    return {
      ts: Number(row.ts),
      query: String(row.query),
      response: String(row.response),
      memoryIds: JSON.parse(String(row.memory_ids ?? "[]")),
    }
  } catch { return null }
}

// Apply a correction: demote cited memories and save the correction as a new memory.
export async function applyCorrection(
  correctionText: string,
  memoryIds: string[],
  tags: string[],
): Promise<void> {
  // Demote cited memories
  await Promise.allSettled(memoryIds.map(id => markMemoryLowConfidence(id)))
  // Save the correction as high-importance so it surfaces next time
  await saveMemory(
    correctionText.trim(),
    "correction",
    { tags, importance: 9, source: "user_said" },
  ).catch(() => {})
}

// Public entrypoint called from the voice route on every incoming message.
// If this looks like a correction of the prior turn, demote and save.
// Returns { applied, memoriesDemoted } for visibility.
export async function checkAndApplyCorrection(
  currentQuery: string,
  tickers: string[],
): Promise<{ applied: boolean; memoriesDemoted: number }> {
  if (!isObviousCorrection(currentQuery)) return { applied: false, memoriesDemoted: 0 }
  const last = await getLastTurn()
  if (!last || !last.memoryIds.length) return { applied: false, memoriesDemoted: 0 }
  await applyCorrection(currentQuery, last.memoryIds, tickers)
  return { applied: true, memoriesDemoted: last.memoryIds.length }
}
