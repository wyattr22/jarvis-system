import { db } from "@/lib/db/client"
import { getBars } from "@/lib/data/alpaca"
import { computeFeatures } from "@/lib/features/engineer"
import { storeFeatures } from "@/lib/features/store"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const instrument = (searchParams.get("instrument") ?? "TSLA").toUpperCase()
  const compute = searchParams.get("compute") === "1"

  // Live on-demand compute (12.5): ANY symbol, fresh bars, stored + returned.
  if (compute) {
    try {
      const bars = await getBars(instrument, "15Min", 500)
      if (bars.length < 30) {
        return Response.json({ error: `not enough bars for ${instrument} (${bars.length})` }, { status: 422 })
      }
      const fs = computeFeatures(instrument, bars)
      if (!fs) {
        return Response.json({ error: `feature computation failed for ${instrument}` }, { status: 422 })
      }
      await storeFeatures(fs).catch(() => {}) // persist best-effort
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 502 })
    }
  }

  // Get the latest snapshot for the instrument
  const snapshotResult = await db.execute({
    sql: `SELECT feature_name, value, timestamp
          FROM features
          WHERE instrument = ? AND timestamp = (
            SELECT MAX(timestamp) FROM features WHERE instrument = ?
          )
          ORDER BY feature_name`,
    args: [instrument, instrument],
  })

  // Get distinct instruments that have features
  const instrumentsResult = await db.execute({
    sql: "SELECT DISTINCT instrument FROM features ORDER BY instrument",
    args: [],
  })

  // Get last 50 timestamps for the instrument
  const historyResult = await db.execute({
    sql: `SELECT DISTINCT timestamp FROM features WHERE instrument = ? ORDER BY timestamp DESC LIMIT 50`,
    args: [instrument],
  })

  const timestamp = snapshotResult.rows[0]?.timestamp ?? null
  const features = snapshotResult.rows.map(r => ({
    name: r.feature_name as string,
    value: r.value as number,
  }))

  return Response.json({
    instrument,
    timestamp,
    features,
    instruments: instrumentsResult.rows.map(r => r.instrument as string),
    historyTimestamps: historyResult.rows.map(r => r.timestamp as number),
  })
}
