// GET /api/system-status — aggregated health check for the dashboard.
// Returns:
//   - cron timing health (last run vs expected interval per cron)
//   - source quality summary
//   - mcp client count + active count (last_seen < 24h)
//   - recent allocations summary
//   - opportunities counts by status
// Read-only, no auth.

import { db } from "@/lib/db/client"

type CronCheck = {
  name: string
  path: string
  last_run_ts: number | null
  last_status: "ok" | "warn" | "down" | "unknown"
  freshness_label: string
}

const CRON_EXPECTED_HOURS: Record<string, number> = {
  "/api/features/compute":            24,
  "/api/drift/check":                 24,
  "/api/council/orchestrate":         7 * 24,
  "/api/brief/generate":              24,
  "/api/sync/fills":                  24,
  "/api/sync/proposal-outcomes":      24,
  "/api/sync/meta-enforce":           24,
  "/api/opportunities/expire":        24,
  "/api/sync/allocation-outcomes":    1,
  "/api/sync/drawdown-check":         0.5,
  "/api/sync/news-scan":              8,
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "never"
  const ms = Date.now() - ts
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export async function GET() {
  // Last execution time per cron path — best signal is the audit_log entry
  // each cron writes. We approximate by looking at the most-recent audit
  // entry whose action mentions the cron's namespace.
  const crons: CronCheck[] = []
  for (const [path, expectedHours] of Object.entries(CRON_EXPECTED_HOURS)) {
    const namespace = path.split("/").pop() ?? path
    let lastTs: number | null = null
    try {
      const r = await db.execute({
        sql: `SELECT MAX(timestamp) AS ts FROM audit_log WHERE actor = ? OR action LIKE ?`,
        args: [namespace, `%${namespace}%`],
      })
      const v = (r.rows[0] as any)?.ts
      lastTs = v ? Number(v) : null
    } catch { /* leave null */ }

    let last_status: CronCheck["last_status"] = "unknown"
    if (lastTs !== null) {
      const ageHours = (Date.now() - lastTs) / 3600_000
      if (ageHours <= expectedHours * 1.5) last_status = "ok"
      else if (ageHours <= expectedHours * 3) last_status = "warn"
      else last_status = "down"
    }

    crons.push({
      name: namespace,
      path,
      last_run_ts: lastTs,
      last_status,
      freshness_label: fmtAgo(lastTs),
    })
  }

  // Source quality summary
  let sources_total = 0
  let sources_quarantined = 0
  try {
    const r = await db.execute(`
      SELECT source_name,
             (SELECT confidence FROM source_quality sq2
              WHERE sq2.source_name = sq.source_name
              ORDER BY ts DESC LIMIT 1) AS last_conf
      FROM source_quality sq
      GROUP BY source_name
    `)
    sources_total = r.rows.length
    for (const row of r.rows) {
      const conf = Number((row as any).last_conf ?? 0)
      if (conf < 0.5) sources_quarantined++
    }
  } catch { /* table may not exist yet */ }

  // MCP clients
  let mcp_clients = 0
  let mcp_clients_active_24h = 0
  try {
    const r = await db.execute(`SELECT COUNT(*) AS n FROM mcp_clients`)
    mcp_clients = Number((r.rows[0] as any).n)
    const r2 = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM mcp_clients WHERE last_seen >= ?`,
      args: [Date.now() - 86400_000],
    })
    mcp_clients_active_24h = Number((r2.rows[0] as any).n)
  } catch { /* ignore */ }

  // Allocations summary
  let allocs_today = 0
  let allocs_filled_7d = 0
  try {
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM allocations WHERE decided_at >= ?`,
      args: [startToday.getTime()],
    })
    allocs_today = Number((r.rows[0] as any).n)
    const r2 = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM allocations WHERE status = 'filled' AND decided_at >= ?`,
      args: [Date.now() - 7 * 86400_000],
    })
    allocs_filled_7d = Number((r2.rows[0] as any).n)
  } catch { /* ignore */ }

  // Opportunities
  const opps_by_status: Record<string, number> = {}
  try {
    const r = await db.execute(`SELECT status, COUNT(*) AS n FROM opportunities GROUP BY status`)
    for (const row of r.rows) {
      opps_by_status[String((row as any).status)] = Number((row as any).n)
    }
  } catch { /* ignore */ }

  // Recent drawdown alerts (last 24h)
  let drawdown_warn = 0
  let drawdown_danger = 0
  try {
    const since = Date.now() - 86400_000
    const r = await db.execute({
      sql: `SELECT action, COUNT(*) AS n FROM audit_log
            WHERE action IN ('drawdown_warn', 'drawdown_danger') AND timestamp >= ?
            GROUP BY action`,
      args: [since],
    })
    for (const row of r.rows) {
      const a = String((row as any).action)
      const n = Number((row as any).n)
      if (a === "drawdown_warn") drawdown_warn = n
      else if (a === "drawdown_danger") drawdown_danger = n
    }
  } catch { /* ignore */ }

  return Response.json({
    ts: Date.now(),
    crons,
    sources: { total: sources_total, quarantined: sources_quarantined },
    mcp_clients: { total: mcp_clients, active_24h: mcp_clients_active_24h },
    allocations: { today: allocs_today, filled_7d: allocs_filled_7d },
    opportunities: opps_by_status,
    drawdown_alerts_24h: { warn: drawdown_warn, danger: drawdown_danger },
  })
}
