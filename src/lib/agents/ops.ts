// Ops agent (13.1) — the site's daily maintainer. Checks every subsystem's
// heartbeat and data quality, writes an ops_reports row, and pushes an alert
// when something needs a human. Pure checks are exported for tests.

import { db } from "@/lib/db/client"
import { getSourceQualitySnapshot } from "@/lib/sandbox/quality"
import { sendPushToAll } from "@/lib/push"
import { auditLog } from "@/lib/guardrails/audit"

export interface OpsCheck {
  name: string
  status: "ok" | "warn" | "down"
  detail: string
}

export interface OpsReport {
  date: string
  status: "healthy" | "degraded" | "broken"
  checks: OpsCheck[]
  created_at: number
}

// Heartbeats: expected max age (hours) per subsystem, matched on audit actor.
// Weekend-aware: market-hours actors get slack when markets were closed.
const HEARTBEATS: { actor: string; label: string; maxAgeHours: number; marketHoursOnly: boolean }[] = [
  { actor: "scanner", label: "Whole-market scanner", maxAgeHours: 30, marketHoursOnly: true },
  { actor: "signal-engine", label: "Signal engine", maxAgeHours: 30, marketHoursOnly: true },
  { actor: "auto-execute", label: "Auto-execute cycle", maxAgeHours: 30, marketHoursOnly: true },
  { actor: "orchestrator", label: "Council", maxAgeHours: 8 * 24, marketHoursOnly: false },
]

// Exported for tests — pure staleness classifier with weekend slack.
export function heartbeatStatus(
  lastTs: number | null,
  maxAgeHours: number,
  marketHoursOnly: boolean,
  now: number = Date.now(),
): "ok" | "warn" | "down" {
  if (lastTs === null) return "down"
  const day = new Date(now).getUTCDay()
  const slack = marketHoursOnly && (day === 0 || day === 6 || day === 1) ? 72 : 0
  const ageHours = (now - lastTs) / 3_600_000
  if (ageHours <= maxAgeHours + slack) return "ok"
  if (ageHours <= (maxAgeHours + slack) * 2) return "warn"
  return "down"
}

async function lastActorEvent(actor: string): Promise<number | null> {
  try {
    const r = await db.execute({
      sql: "SELECT MAX(timestamp) AS ts FROM audit_log WHERE actor = ?",
      args: [actor],
    })
    const v = r.rows[0]?.ts
    return v ? Number(v) : null
  } catch {
    return null
  }
}

async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ops_reports (
      date TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      checks_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

export async function runOpsAgent(): Promise<OpsReport> {
  const checks: OpsCheck[] = []
  const fmtAgo = (ts: number | null) =>
    ts === null ? "never" : `${Math.round((Date.now() - ts) / 3_600_000)}h ago`

  // 1. Subsystem heartbeats
  for (const hb of HEARTBEATS) {
    const ts = await lastActorEvent(hb.actor)
    checks.push({
      name: hb.label,
      status: heartbeatStatus(ts, hb.maxAgeHours, hb.marketHoursOnly),
      detail: `last activity ${fmtAgo(ts)}`,
    })
  }

  // 2. Data-source quality (24h pass rates from the quality gate)
  try {
    const sources = await getSourceQualitySnapshot()
    const bad = sources.filter(s => s.count_24h >= 3 && s.pass_rate_24h < 0.5)
    checks.push({
      name: "Data sources",
      status: bad.length === 0 ? "ok" : bad.length <= 2 ? "warn" : "down",
      detail: bad.length
        ? `failing: ${bad.map(b => `${b.source_name} (${Math.round(b.pass_rate_24h * 100)}%)`).join(", ")}`
        : `${sources.length} sources healthy`,
    })
  } catch (err) {
    checks.push({ name: "Data sources", status: "warn", detail: `quality snapshot failed: ${String(err).slice(0, 80)}` })
  }

  // 3. Order errors in the last 24h
  try {
    const r = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM allocations WHERE status = 'error' AND created_at > ?",
      args: [Date.now() - 86_400_000],
    })
    const n = Number(r.rows[0]?.n ?? 0)
    checks.push({
      name: "Order placement",
      status: n === 0 ? "ok" : n <= 2 ? "warn" : "down",
      detail: n === 0 ? "no failed orders" : `${n} failed order${n === 1 ? "" : "s"} in 24h — check /allocations`,
    })
  } catch {
    checks.push({ name: "Order placement", status: "ok", detail: "no allocations table activity" })
  }

  // 4. Universe freshness
  try {
    const r = await db.execute({ sql: "SELECT MAX(scanned_at) AS ts, COUNT(*) AS n FROM scan_universe", args: [] })
    const ts = r.rows[0]?.ts ? Number(r.rows[0].ts) : null
    checks.push({
      name: "Symbol universe",
      status: heartbeatStatus(ts, 30, true),
      detail: ts ? `${Number(r.rows[0]?.n ?? 0)} symbols, refreshed ${fmtAgo(ts)}` : "never scanned",
    })
  } catch {
    checks.push({ name: "Symbol universe", status: "down", detail: "scan_universe unreadable" })
  }

  const worst = checks.some(c => c.status === "down") ? "broken"
    : checks.some(c => c.status === "warn") ? "degraded" : "healthy"

  const report: OpsReport = {
    date: new Date().toISOString().split("T")[0],
    status: worst,
    checks,
    created_at: Date.now(),
  }

  await ensureTable()
  await db.execute({
    sql: `INSERT OR REPLACE INTO ops_reports (date, status, checks_json, created_at) VALUES (?,?,?,?)`,
    args: [report.date, report.status, JSON.stringify(checks), report.created_at],
  })
  await auditLog("ops-agent", "ops_report", { status: worst, issues: checks.filter(c => c.status !== "ok").length }).catch(() => {})

  if (worst !== "healthy") {
    const issues = checks.filter(c => c.status !== "ok")
    await sendPushToAll({
      title: worst === "broken" ? "🔴 Jarvis needs attention" : "🟡 Jarvis is degraded",
      body: issues.map(i => `${i.name}: ${i.detail}`).join(" · ").slice(0, 180),
      tag: "ops-report",
      url: "/system-status",
    }).catch(() => {})
  }

  return report
}
