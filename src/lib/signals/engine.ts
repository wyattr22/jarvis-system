// Internal signal engine (12.4, generalized 17): runs every enabled
// strategy's own logic over its own universe, so Jarvis generates signals
// for whatever strategies exist — not just the one hardcoded smc-ict-v4 —
// while smc-ict-v4 itself keeps scanning the rotating equity universe
// exactly as before.
//
// Data cost per sweep (top-50 universe): 2 multi-symbol batch calls
// (15Min + 1Day) + 1 SPY call ≈ 3-4 requests — pinger-friendly at any cadence.
// A strategy whose universe is a non-equity list (e.g. forex pairs) isn't
// wired to real bar-fetching yet — fetchBatchBars is Alpaca-only, so those
// symbols simply come back with no bars and get skipped, same as any other
// insufficient-data case. Not a crash, just a no-op until a broker-aware
// bar-fetch path exists for that asset class.

import { safeFetch } from "@/lib/sandbox/whitelist"
import { db } from "@/lib/db/client"
import { auditLog } from "@/lib/guardrails/audit"
import { getActiveUniverse } from "@/lib/universe/store"
import { getFeatureSnapshot } from "@/lib/features/store"
import type { Bar, BotSignal } from "@/lib/backtest/bot-strategy"
import { getSignalForStrategy, getStrategyDefinition } from "@/lib/strategy-engine/dispatch"

const DATA_BASE = "https://data.alpaca.markets/v2"
export const SCAN_DEPTH = 50           // top of the rotating universe per sweep
export const COOLDOWN_MS = 4 * 60 * 60 * 1000 // one signal per symbol per 4h

function headers() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  }
}

async function fetchBatchBars(
  symbols: string[],
  timeframe: string,
  daysBack: number,
): Promise<Record<string, Bar[]>> {
  if (!symbols.length) return {}
  const start = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0]
  const url = `${DATA_BASE}/stocks/bars?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&timeframe=${timeframe}&start=${start}&feed=iex&limit=10000`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`bars batch error: ${res.status}`)
  const json = await res.json()
  return json.bars ?? {}
}

/** Recent-signal cooldown: true when a signal for this (strategy, symbol) is too fresh. */
export function inCooldown(lastSignalAt: number | null, now: number, cooldownMs = COOLDOWN_MS): boolean {
  return lastSignalAt !== null && now - lastSignalAt < cooldownMs
}

async function lastSignalTime(strategyId: string, instrument: string): Promise<number | null> {
  const res = await db.execute({
    sql: "SELECT MAX(created_at) AS ts FROM signals WHERE instrument = ? AND strategy_id = ?",
    args: [instrument, strategyId],
  })
  const ts = res.rows[0]?.ts
  return ts ? Number(ts) : null
}

async function insertSignal(strategyId: string, sig: BotSignal): Promise<string> {
  const id = `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const featureSnapshot = await getFeatureSnapshot(sig.symbol, Date.now()).catch(() => null)
  await db.execute({
    sql: `INSERT INTO signals
            (id, strategy_id, instrument, direction, entry, stop, target,
             confidence, reasoning_json, feature_snapshot_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [
      id,
      strategyId,
      sig.symbol,
      sig.bias === "bullish" ? "long" : "short",
      sig.price,
      sig.sl,
      sig.tp,
      Math.min(0.95, 0.5 + 0.05 * (sig.revTags.length + sig.contTags.length)),
      JSON.stringify({
        text: `internal scan: ${[...sig.revTags, ...sig.contTags].join(", ")} | RR ${sig.rr.toFixed(2)} RSI ${sig.rsi.toFixed(0)}`,
        type: "entry",
        source: "jarvis-signal-engine",
        tags: { reversal: sig.revTags, continuation: sig.contTags },
      }),
      featureSnapshot ? JSON.stringify(featureSnapshot) : null,
      Date.now(),
    ],
  })
  return id
}

async function getEnabledStrategyIds(): Promise<string[]> {
  const res = await db.execute({ sql: "SELECT id FROM strategies WHERE enabled = 1", args: [] })
  const ids = res.rows.map(r => String(r.id))
  // Table may not have any enabled rows yet on a fresh DB (seed script not
  // run) — fall back to the one strategy this app has always shipped with,
  // matching pre-17 behavior exactly rather than silently scanning nothing.
  return ids.length ? ids : ["smc-ict-v4"]
}

export interface SweepResult {
  universe: number
  checked: number
  signals: { id: string; symbol: string; bias: string; rr: number; strategyId: string }[]
  skippedCooldown: number
  tookMs: number
}

/** One sweep: every enabled strategy's own logic over its own universe. */
export async function runSignalSweep(depth = SCAN_DEPTH): Promise<SweepResult> {
  const started = Date.now()
  const strategyIds = await getEnabledStrategyIds()

  const results: SweepResult = {
    universe: 0,
    checked: 0,
    signals: [],
    skippedCooldown: 0,
    tookMs: 0,
  }

  // Cache batch-bar fetches by universe key so strategies sharing
  // "active_scan_universe" (the common case) only fetch once per sweep.
  const barsCache = new Map<string, { bars15mAll: Record<string, Bar[]>; dailyAll: Record<string, Bar[]> }>()
  let spyBars: Bar[] | null = null

  for (const strategyId of strategyIds) {
    const def = await getStrategyDefinition(strategyId)
    const universeSpec = def?.universe ?? "active_scan_universe"
    const universe = universeSpec === "active_scan_universe"
      ? await getActiveUniverse(depth)
      : universeSpec

    const cacheKey = universeSpec === "active_scan_universe" ? "active_scan_universe" : universe.join(",")
    let cached = barsCache.get(cacheKey)
    if (!cached) {
      const [bars15mAll, dailyAll] = await Promise.all([
        fetchBatchBars(universe, "15Min", 4),
        fetchBatchBars(universe, "1Day", 45),
      ])
      cached = { bars15mAll, dailyAll }
      barsCache.set(cacheKey, cached)
    }
    if (spyBars === null) {
      const spy15mAll = await fetchBatchBars(["SPY"], "15Min", 4)
      spyBars = spy15mAll["SPY"] ?? []
    }

    results.universe += universe.length

    for (const symbol of universe) {
      const bars15m = cached.bars15mAll[symbol] ?? []
      const daily = cached.dailyAll[symbol] ?? []
      if (bars15m.length < 40 || daily.length < 5) continue
      results.checked++

      const sig = await getSignalForStrategy(strategyId, bars15m, daily, spyBars, bars15m.length - 1, symbol)
      if (!sig) continue

      if (inCooldown(await lastSignalTime(strategyId, symbol), Date.now())) {
        results.skippedCooldown++
        continue
      }

      const id = await insertSignal(strategyId, sig)
      results.signals.push({ id, symbol, bias: sig.bias, rr: Number(sig.rr.toFixed(2)), strategyId })
    }
  }

  results.tookMs = Date.now() - started
  await auditLog("signal-engine", "signal_sweep_complete", {
    strategies: strategyIds.length,
    universe: results.universe,
    checked: results.checked,
    found: results.signals.length,
    skippedCooldown: results.skippedCooldown,
    tookMs: results.tookMs,
  }).catch(() => {})
  return results
}
