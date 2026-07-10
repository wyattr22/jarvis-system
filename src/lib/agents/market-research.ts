// Research agent (13.2) — Jarvis's daily analyst. Pre-market, it reads the
// reputable sources (13.2a: Fed releases, fund research, market podcasts),
// the intermarket picture, options positioning, and the rotating universe,
// then writes a structured research note. The note is:
//   1. stored in research_notes (rendered on /news + /digest)
//   2. ingested into the research store (semantic-searchable by voice/council)

import { db } from "@/lib/db/client"
import { route } from "@/lib/llm/router"
import { fetchAllRSSFeeds } from "@/lib/data/rss"
import { getIntermarketSnapshot, formatIntermarketForContext } from "@/lib/data/intermarket"
import { getOptionsSnapshot, formatOptionsForContext } from "@/lib/data/options"
import { getUniverseRows } from "@/lib/universe/store"
import { ingestResearch } from "@/lib/research/store"
import { auditLog } from "@/lib/guardrails/audit"

export interface ResearchNote {
  date: string
  regime: string
  note: string
  created_at: number
}

async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_notes (
      date TEXT PRIMARY KEY,
      regime TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

// Exported for tests — pure context assembly from gathered inputs.
export function buildResearchContext(inputs: {
  headlines: { source: string; title: string }[]
  intermarket: string
  optionsPulse: string | null
  topUniverse: { symbol: string; reason: string; change_pct: number }[]
}): string {
  const parts: string[] = []
  if (inputs.headlines.length) {
    parts.push("LATEST FROM REPUTABLE SOURCES (Fed, fund research, market podcasts):")
    for (const h of inputs.headlines.slice(0, 30)) parts.push(`- [${h.source}] ${h.title}`)
  }
  parts.push(`\nINTERMARKET: ${inputs.intermarket}`)
  if (inputs.optionsPulse) parts.push(`OPTIONS POSITIONING: ${inputs.optionsPulse}`)
  if (inputs.topUniverse.length) {
    parts.push("\nTOP OF TODAY'S SCANNED UNIVERSE (whole-market scan):")
    for (const u of inputs.topUniverse.slice(0, 15)) {
      parts.push(`- ${u.symbol}: ${u.change_pct >= 0 ? "+" : ""}${u.change_pct}% (${u.reason})`)
    }
  }
  return parts.join("\n")
}

const SYSTEM_PROMPT = `You are Jarvis's market research analyst. Write today's pre-market research note from the provided context ONLY — do not invent facts or prices.

Format (markdown, under 400 words):
## Regime
One line: risk-on / risk-off / mixed, and why.
## What matters today
3-5 bullets, each tied to a specific source item from the context.
## Where the opportunity is
2-3 bullets connecting the scanned universe names to the macro picture.
## What would change my mind
One bullet — the disconfirming signal to watch.

Be terse, specific, and honest about uncertainty. British, dry.`

export async function runResearchAgent(): Promise<ResearchNote> {
  const [headlines, intermarket, spyOptions, universe] = await Promise.all([
    fetchAllRSSFeeds().catch(() => []),
    getIntermarketSnapshot().catch(() => null),
    getOptionsSnapshot("SPY").catch(() => null),
    getUniverseRows(15).catch(() => []),
  ])

  const context = buildResearchContext({
    headlines: headlines.map(h => ({ source: h.source, title: h.title })),
    intermarket: intermarket ? formatIntermarketForContext(intermarket) : "unavailable",
    optionsPulse: spyOptions ? formatOptionsForContext("SPY", spyOptions) : null,
    topUniverse: universe.map(u => ({ symbol: u.symbol, reason: u.reason, change_pct: u.change_pct })),
  })

  const note = await route({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: context },
    ],
    maxTokens: 700,
    temperature: 0.4,
    cacheable: false,
  })

  const regimeMatch = note.match(/## Regime\s*\n+([^\n]+)/)
  const regime = regimeMatch ? regimeMatch[1].trim().slice(0, 200) : "unclassified"
  const date = new Date().toISOString().split("T")[0]

  await ensureTable()
  await db.execute({
    sql: "INSERT OR REPLACE INTO research_notes (date, regime, note, created_at) VALUES (?,?,?,?)",
    args: [date, regime, note, Date.now()],
  })

  // Semantic-searchable for voice + council context
  await ingestResearch(`daily-note-${date}`, note, `Jarvis research note ${date}: ${regime}`).catch(() => {})
  await auditLog("research-agent", "research_note_written", { date, regime, sources: headlines.length }).catch(() => {})

  return { date, regime, note, created_at: Date.now() }
}

export async function getLatestResearchNotes(limit = 7): Promise<ResearchNote[]> {
  await ensureTable()
  const r = await db.execute({
    sql: "SELECT date, regime, note, created_at FROM research_notes ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  })
  return r.rows.map(row => ({
    date: String(row.date),
    regime: String(row.regime),
    note: String(row.note),
    created_at: Number(row.created_at),
  }))
}
