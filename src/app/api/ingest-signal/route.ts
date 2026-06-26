import { db } from "@/lib/db/client"
import { getFeatureSnapshot } from "@/lib/features/store"
import { auditLog } from "@/lib/guardrails/audit"

// POST /api/ingest-signal — called by Python bot.py to push signal events
export async function POST(req: Request) {
  const body = await req.json()

  const {
    strategy_id,
    instrument,
    direction,       // "long" | "short"
    entry,
    stop,
    target,
    confidence,
    reasoning,
    signal_type,     // "entry" | "exit" | "alert"
  } = body

  if (!strategy_id || !instrument || !direction) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const featureSnapshot = await getFeatureSnapshot(instrument, Date.now()).catch(() => null)

  const id = `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.execute({
    sql: `INSERT INTO signals
            (id, strategy_id, instrument, direction, entry, stop, target,
             confidence, reasoning_json, feature_snapshot_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [
      id,
      strategy_id,
      instrument,
      direction,
      entry ?? null,
      stop ?? null,
      target ?? null,
      confidence ?? null,
      reasoning ? JSON.stringify({ text: reasoning, type: signal_type ?? "entry" }) : null,
      featureSnapshot ? JSON.stringify(featureSnapshot) : null,
      Date.now(),
    ],
  })

  await auditLog("bot", "signal_ingested", { id, strategy_id, instrument, direction })

  return Response.json({ ok: true, id })
}
