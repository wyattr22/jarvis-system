import { db } from "@/lib/db/client"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const instrument = searchParams.get("instrument") ?? "TSLA"

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
