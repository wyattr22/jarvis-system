import { db } from "@/lib/db/client"
import type { FeatureSet } from "./engineer"

async function ensureTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS features (
      instrument TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      feature_name TEXT NOT NULL,
      value REAL,
      PRIMARY KEY (instrument, timestamp, feature_name)
    )
  `)
}

export async function storeFeatures(fs: FeatureSet): Promise<void> {
  await ensureTable()
  const args = Object.entries(fs.features).map(([name, value]) => [
    fs.instrument,
    fs.timestamp,
    name,
    value,
  ])

  // Batch insert using transactions
  const stmts = args.map(([instrument, timestamp, feature_name, value]) => ({
    sql: `INSERT OR REPLACE INTO features (instrument, timestamp, feature_name, value)
          VALUES (?, ?, ?, ?)`,
    args: [instrument, timestamp, feature_name, value],
  }))

  await db.batch(stmts, "write")
}

export async function getFeatures(
  instrument: string,
  timestamp: number
): Promise<Record<string, number>> {
  await ensureTable()
  const rows = await db.execute({
    sql: "SELECT feature_name, value FROM features WHERE instrument = ? AND timestamp = ?",
    args: [instrument, timestamp],
  })
  return Object.fromEntries(rows.rows.map(r => [r.feature_name as string, r.value as number]))
}

export async function getFeatureHistory(
  instrument: string,
  featureName: string,
  limit = 200
): Promise<{ timestamp: number; value: number }[]> {
  const rows = await db.execute({
    sql: `SELECT timestamp, value FROM features
          WHERE instrument = ? AND feature_name = ?
          ORDER BY timestamp DESC LIMIT ?`,
    args: [instrument, featureName, limit],
  })
  return rows.rows.map(r => ({
    timestamp: r.timestamp as number,
    value: r.value as number,
  }))
}

export async function getFeatureSnapshot(
  instrument: string,
  maxTimestamp: number
): Promise<Record<string, number>> {
  await ensureTable()
  const rows = await db.execute({
    sql: `SELECT feature_name, value FROM features
          WHERE instrument = ? AND timestamp = (
            SELECT MAX(timestamp) FROM features
            WHERE instrument = ? AND timestamp <= ?
          )`,
    args: [instrument, instrument, maxTimestamp],
  })
  return Object.fromEntries(rows.rows.map(r => [r.feature_name as string, r.value as number]))
}
