import { db } from "@/lib/db/client"
import { getSourceQualitySnapshot } from "@/lib/sandbox/quality"

export async function GET() {
  const snapshot = await getSourceQualitySnapshot()

  // Count of recent blocked sandbox attempts (last 24h) so the UI can flag drift
  let blockedCount = 0
  try {
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM audit_log WHERE action='blocked_fetch' AND timestamp >= ?`,
      args: [Date.now() - 24 * 60 * 60 * 1000],
    })
    blockedCount = Number((r.rows[0] as any)?.n ?? 0)
  } catch { /* table may not exist on cold DB */ }

  // Quarantine count: sources whose last event was below threshold
  const quarantined = snapshot.filter(s => s.last_confidence < 0.5).length

  return Response.json({
    sources: snapshot,
    quarantined,
    sandbox_blocked_24h: blockedCount,
    threshold: 0.5,
  })
}
