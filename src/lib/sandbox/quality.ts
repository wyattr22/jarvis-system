// Source Quality Gate — every external data source is validated before
// its result is allowed into the LLM context or the predictive model.
//
//   evaluateSource(name, fetcher)
//     → runs fetcher
//     → validates result against the registered spec (sanity bounds, schema)
//     → scores confidence in [0,1] from validation + freshness + track record
//     → logs the outcome to source_quality table
//     → returns { data, confidence, ok, reason }
//
// Callers decide what to do with low confidence. Convention:
//   confidence >= 0.5 → safe to feed into LLM context + predictive model
//   confidence <  0.5 → strip from model input; still render on dashboard with badge

import { db } from "@/lib/db/client"

export type Confidence = number  // 0.0 .. 1.0

export type SourceResult<T> = {
  data: T | null
  confidence: Confidence
  ok: boolean
  reason?: string
}

type ValidateResult = { ok: boolean; reason?: string }
type SourceSpec = {
  name: string
  maxAgeMs: number
  validate: (data: unknown) => ValidateResult
}

// Per-source moving track record (in-memory, rebuilds from DB on cold start).
// 100-entry circular buffer per source.
const trackRecord = new Map<string, boolean[]>()
const TRACK_CAP = 100

function recordOutcome(name: string, ok: boolean): void {
  const arr = trackRecord.get(name) ?? []
  arr.push(ok)
  if (arr.length > TRACK_CAP) arr.shift()
  trackRecord.set(name, arr)
}

function passRate(name: string): number {
  const arr = trackRecord.get(name)
  if (!arr || arr.length === 0) return 0.5  // unknown source — neutral
  const ok = arr.filter(Boolean).length
  return ok / arr.length
}

// Source registry — declare every data source we trust here.
const REGISTRY: Record<string, SourceSpec> = {
  "alpaca.quote": {
    name: "alpaca.quote",
    maxAgeMs: 20_000,
    validate: (q: any) =>
      q && typeof q.bid === "number" && typeof q.ask === "number" &&
      q.bid > 0 && q.ask > 0 && q.ask <= q.bid * 1.5
        ? { ok: true }
        : { ok: false, reason: `oob:bid=${q?.bid} ask=${q?.ask}` },
  },
  "alpaca.bars": {
    name: "alpaca.bars",
    maxAgeMs: 5 * 60_000,
    validate: (b: any) =>
      Array.isArray(b) && b.length >= 5
        ? { ok: true }
        : { ok: false, reason: `len=${Array.isArray(b) ? b.length : "nonArray"}` },
  },
  "alpaca.account": {
    name: "alpaca.account",
    maxAgeMs: 60_000,
    validate: (a: any) =>
      a && typeof a.equity === "string"
        ? { ok: true }
        : { ok: false, reason: "missing equity" },
  },
  "alpaca.positions": {
    name: "alpaca.positions",
    maxAgeMs: 60_000,
    validate: (p: any) =>
      Array.isArray(p) ? { ok: true } : { ok: false, reason: "nonArray" },
  },
  "yahoo.vix": {
    name: "yahoo.vix",
    maxAgeMs: 10 * 60_000,
    validate: (v: any) =>
      typeof v === "number" && v > 5 && v < 100
        ? { ok: true }
        : { ok: false, reason: `oob:vix=${v}` },
  },
  "yahoo.intermarket": {
    name: "yahoo.intermarket",
    maxAgeMs: 15 * 60_000,
    validate: (m: any) =>
      m && typeof m === "object" && Object.keys(m).length > 0
        ? { ok: true }
        : { ok: false, reason: "empty" },
  },
  "yahoo.options": {
    name: "yahoo.options",
    maxAgeMs: 10 * 60_000,
    validate: (o: any) =>
      o && (o.calls || o.puts) ? { ok: true } : { ok: false, reason: "no chain" },
  },
  "stocktwits.sentiment": {
    name: "stocktwits.sentiment",
    maxAgeMs: 10 * 60_000,
    validate: (s: any) =>
      Array.isArray(s) || (s && typeof s.bullCount === "number")
        ? { ok: true }
        : { ok: false, reason: "schema" },
  },
  "sec.insider": {
    name: "sec.insider",
    maxAgeMs: 24 * 60 * 60_000,
    validate: (r: any) =>
      r !== undefined && r !== null ? { ok: true } : { ok: false, reason: "null" },
  },
  "alphavantage.economic": {
    name: "alphavantage.economic",
    maxAgeMs: 60 * 60_000,
    validate: (d: any) =>
      d ? { ok: true } : { ok: false, reason: "null" },
  },
  "alphavantage.earnings": {
    name: "alphavantage.earnings",
    maxAgeMs: 6 * 60 * 60_000,
    validate: (d: any) =>
      d ? { ok: true } : { ok: false, reason: "null" },
  },
  "alpaca.btc": {
    name: "alpaca.btc",
    maxAgeMs: 5 * 60_000,
    validate: (d: any) =>
      d && typeof d.price === "number" && d.price > 0
        ? { ok: true }
        : { ok: false, reason: "schema" },
  },
}

let tableEnsured = false
async function ensureTable(): Promise<void> {
  if (tableEnsured) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS source_quality (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      ts INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT,
      latency_ms INTEGER
    )
  `)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sq_source_ts ON source_quality(source_name, ts DESC)`)
  tableEnsured = true
}

async function logEvent(
  name: string, ok: boolean, confidence: number, reason: string | undefined, latencyMs: number
): Promise<void> {
  try {
    await ensureTable()
    await db.execute({
      sql: `INSERT INTO source_quality (source_name, ts, ok, confidence, reason, latency_ms) VALUES (?,?,?,?,?,?)`,
      args: [name, Date.now(), ok ? 1 : 0, confidence, reason ?? null, latencyMs],
    })
  } catch { /* logging is best-effort */ }
}

function scoreConfidence(spec: SourceSpec, validationOk: boolean, fetchAgeMs: number, name: string): number {
  if (!validationOk) return 0
  // Freshness: linear decay from 1.0 at age=0 to 0.0 at age=maxAge
  const freshness = Math.max(0, 1 - fetchAgeMs / spec.maxAgeMs)
  // Track record bonus
  const track = passRate(name)
  // Weighted blend
  const score = 0.5 * freshness + 0.3 * track + 0.2  // 0.2 base for passing validation
  return Math.min(1, Math.max(0, score))
}

export async function evaluateSource<T>(
  name: string,
  fetcher: () => Promise<T>,
): Promise<SourceResult<T>> {
  const spec = REGISTRY[name]
  const start = Date.now()
  let data: T | null = null
  let fetchError: Error | null = null

  try {
    data = await fetcher()
  } catch (err) {
    fetchError = err as Error
  }

  const latencyMs = Date.now() - start

  if (fetchError || data === null || data === undefined) {
    recordOutcome(name, false)
    await logEvent(name, false, 0, fetchError?.message?.slice(0, 200) ?? "null", latencyMs)
    return { data: null, confidence: 0, ok: false, reason: fetchError?.message ?? "null result" }
  }

  // Unknown source — pass-through with a neutral score and a log entry to surface it
  if (!spec) {
    recordOutcome(name, true)
    await logEvent(name, true, 0.5, "unregistered_source", latencyMs)
    return { data, confidence: 0.5, ok: true }
  }

  const v = spec.validate(data)
  const confidence = scoreConfidence(spec, v.ok, latencyMs, name)
  recordOutcome(name, v.ok)
  await logEvent(name, v.ok, confidence, v.reason, latencyMs)

  return { data: v.ok ? data : null, confidence, ok: v.ok, reason: v.reason }
}

// Helper for callers that want to silently use the data only when safe.
// Returns the data if confidence ≥ threshold; otherwise null.
export async function gated<T>(
  name: string,
  fetcher: () => Promise<T>,
  threshold = 0.5,
): Promise<T | null> {
  const r = await evaluateSource(name, fetcher)
  return r.confidence >= threshold ? r.data : null
}

export async function getSourceQualitySnapshot(): Promise<{
  source_name: string
  last_ok: number
  last_confidence: number
  last_ts: number
  pass_rate_24h: number
  count_24h: number
}[]> {
  await ensureTable()
  const since = Date.now() - 24 * 60 * 60 * 1000
  const rows = await db.execute({
    sql: `
      SELECT source_name,
             SUM(ok) * 1.0 / COUNT(*) AS pass_rate,
             COUNT(*) AS n,
             MAX(ts) AS last_ts
      FROM source_quality
      WHERE ts >= ?
      GROUP BY source_name
      ORDER BY source_name
    `,
    args: [since],
  })
  const out: any[] = []
  for (const r of rows.rows) {
    const latest = await db.execute({
      sql: `SELECT ok, confidence, ts FROM source_quality WHERE source_name = ? ORDER BY ts DESC LIMIT 1`,
      args: [String(r.source_name)],
    })
    const top = latest.rows[0]
    out.push({
      source_name: String(r.source_name),
      last_ok: top ? Number(top.ok) : 0,
      last_confidence: top ? Number(top.confidence) : 0,
      last_ts: Number(r.last_ts),
      pass_rate_24h: Number(r.pass_rate ?? 0),
      count_24h: Number(r.n ?? 0),
    })
  }
  return out
}
