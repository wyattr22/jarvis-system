// Daily digest (13.3) — "what Jarvis thought and did today."
// Post-close, gathers the day's actions (humanized audit log), signals,
// orders, P&L, ops health, and the morning's research note, then narrates
// them in Jarvis's voice. Stored + pushed to the user's devices.

import { db } from "@/lib/db/client"
import { route } from "@/lib/llm/router"
import { humanizeAction, ACTOR_LABELS } from "@/lib/audit/humanize"
import { getLatestResearchNotes } from "./market-research"
import { sendPushToAll } from "@/lib/push"
import { auditLog } from "@/lib/guardrails/audit"
import { getAccount } from "@/lib/data/alpaca"

export interface DailyDigest {
  date: string
  headline: string
  digest: string
  created_at: number
}

async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS daily_digests (
      date TEXT PRIMARY KEY,
      headline TEXT NOT NULL,
      digest TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

// Exported for tests — pure digest-context assembly.
export function buildDigestContext(inputs: {
  actions: { actor: string; line: string }[]
  signals: { instrument: string; direction: string; status: string }[]
  orders: { symbol: string; decided_by: string; status: string }[]
  equity: number | null
  dayPnl: number | null
  researchNote: string | null
  opsStatus: string | null
}): string {
  const parts: string[] = []
  if (inputs.researchNote) {
    parts.push(`THIS MORNING'S RESEARCH VIEW:\n${inputs.researchNote.slice(0, 800)}`)
  }
  parts.push(`\nACTIONS TAKEN TODAY (${inputs.actions.length}):`)
  for (const a of inputs.actions.slice(0, 40)) parts.push(`- [${a.actor}] ${a.line}`)
  if (inputs.signals.length) {
    parts.push(`\nSIGNALS FOUND TODAY (${inputs.signals.length}):`)
    for (const s of inputs.signals.slice(0, 15)) parts.push(`- ${s.instrument} ${s.direction} (${s.status})`)
  } else {
    parts.push("\nNo new signals today.")
  }
  if (inputs.orders.length) {
    parts.push(`\nORDERS PLACED (${inputs.orders.length}):`)
    for (const o of inputs.orders) parts.push(`- ${o.symbol} (${o.decided_by}, ${o.status})`)
  } else {
    parts.push("\nNo orders placed.")
  }
  if (inputs.equity !== null) {
    parts.push(`\nACCOUNT: equity $${inputs.equity.toFixed(0)}${inputs.dayPnl !== null ? `, day P&L $${inputs.dayPnl.toFixed(0)}` : ""}`)
  }
  if (inputs.opsStatus) parts.push(`SYSTEM HEALTH: ${inputs.opsStatus}`)
  return parts.join("\n")
}

const SYSTEM_PROMPT = `You are Jarvis, reporting to your principal at the end of the trading day. Using ONLY the provided context, write the daily debrief.

Format (markdown, under 300 words):
First line: a single-sentence headline of the day (no heading marker).
## What I did
Plain summary of the day's activity — scans, signals, orders, or the honest "watched and waited".
## What I'm thinking
Connect today's outcomes to this morning's research view. Say if the view held up or not.
## Tomorrow
One or two lines on what you're watching next.

British, dry, first person. Never invent numbers not in the context.`

export async function runDailyDigest(): Promise<DailyDigest> {
  const since = Date.now() - 24 * 60 * 60 * 1000

  const [auditRows, signalRows, orderRows, notes, opsRow] = await Promise.all([
    db.execute({ sql: "SELECT actor, action, details_json FROM audit_log WHERE timestamp > ? ORDER BY timestamp ASC LIMIT 200", args: [since] }),
    db.execute({ sql: "SELECT instrument, direction, status FROM signals WHERE created_at > ?", args: [since] }),
    db.execute({ sql: "SELECT a.status, a.decided_by, o.instrument AS symbol FROM allocations a LEFT JOIN opportunities o ON o.id = a.opportunity_id WHERE a.created_at > ?", args: [since] }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
    getLatestResearchNotes(1).catch(() => []),
    db.execute({ sql: "SELECT status FROM ops_reports ORDER BY created_at DESC LIMIT 1", args: [] }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ])

  let equity: number | null = null
  let dayPnl: number | null = null
  try {
    const acct = await getAccount()
    equity = Number(acct.equity)
    dayPnl = acct.equity && acct.last_equity ? Number(acct.equity) - Number(acct.last_equity) : null
  } catch { /* account optional */ }

  const context = buildDigestContext({
    actions: auditRows.rows.map(r => {
      let details: Record<string, unknown> | null = null
      try { details = r.details_json ? JSON.parse(String(r.details_json)) : null } catch { /* null */ }
      return {
        actor: ACTOR_LABELS[String(r.actor)] ?? String(r.actor),
        line: humanizeAction(String(r.action), details),
      }
    }),
    signals: signalRows.rows.map(r => ({
      instrument: String(r.instrument), direction: String(r.direction), status: String(r.status),
    })),
    orders: (orderRows.rows as Record<string, unknown>[]).map(r => ({
      symbol: String(r.symbol ?? "?"), decided_by: String(r.decided_by ?? "?"), status: String(r.status ?? "?"),
    })),
    equity,
    dayPnl,
    researchNote: notes[0]?.note ?? null,
    opsStatus: opsRow.rows[0] ? String(opsRow.rows[0].status) : null,
  })

  const digest = await route({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: context },
    ],
    maxTokens: 600,
    temperature: 0.5,
    cacheable: false,
  })

  const headline = digest.split("\n").find(l => l.trim() && !l.startsWith("#"))?.trim().slice(0, 180) ?? "Daily debrief ready"
  const date = new Date().toISOString().split("T")[0]

  await ensureTable()
  await db.execute({
    sql: "INSERT OR REPLACE INTO daily_digests (date, headline, digest, created_at) VALUES (?,?,?,?)",
    args: [date, headline, digest, Date.now()],
  })
  await auditLog("digest-agent", "daily_digest_written", { date }).catch(() => {})

  await sendPushToAll({
    title: "🧠 Jarvis — today's debrief",
    body: headline,
    tag: "daily-digest",
    url: "/digest",
  }).catch(() => {})

  return { date, headline, digest, created_at: Date.now() }
}

export async function getDigests(limit = 14): Promise<DailyDigest[]> {
  await ensureTable()
  const r = await db.execute({
    sql: "SELECT date, headline, digest, created_at FROM daily_digests ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  })
  return r.rows.map(row => ({
    date: String(row.date),
    headline: String(row.headline),
    digest: String(row.digest),
    created_at: Number(row.created_at),
  }))
}
