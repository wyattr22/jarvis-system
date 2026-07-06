// Internal signal engine (12.4): runs the ported smc-ict-v4 logic over the
// rotating scan universe, so Jarvis generates its own signals instead of
// depending on the external bot.py and its 12 hardcoded symbols.
//
// Data cost per sweep (top-50 universe): 2 multi-symbol batch calls
// (15Min + 1Day) + 1 SPY call ≈ 3-4 requests — pinger-friendly at any cadence.

import { safeFetch } from "@/lib/sandbox/whitelist"
import { db } from "@/lib/db/client"
import { auditLog } from "@/lib/guardrails/audit"
import { getActiveUniverse } from "@/lib/universe/store"
import { getFeatureSnapshot } from "@/lib/features/store"
import { checkBotSignal, type Bar, type BotSignal } from "@/lib/backtest/bot-strategy"

const DATA_BASE = "https://data.alpaca.markets/v2"
const STRATEGY_ID = "smc-ict-v4"
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
  const start = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0]
  const url = `${DATA_BASE}/stocks/bars?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&timeframe=${timeframe}&start=${start}&feed=iex&limit=10000`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`bars batch error: ${res.status}`)
  const json = await res.json()
  return json.bars ?? {}
}

/** Recent-signal cooldown: true when a signal for this symbol is too fresh. */
export function inCooldown(lastSignalAt: number | null, now: number, cooldownMs = COOLDOWN_MS): boolean {
  return lastSignalAt !== null && now - lastSignalAt < cooldownMs
}

async function lastSignalTime(instrument: string): Promise<number | null> {
  const res = await db.execute({
    sql: "SELECT MAX(created_at) AS ts FROM signals WHERE instrument = ? AND strategy_id = ?",
    args: [instrument, STRATEGY_ID],
  })
  const ts = res.rows[0]?.ts
  return ts ? Number(ts) : null
}

async function insertSignal(sig: BotSignal): Promise<string> {
  const id = `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const featureSnapshot = await getFeatureSnapshot(sig.symbol, Date.now()).catch(() => null)
  await db.execute({
    sql: `INSERT INTO signals
            (id, strategy_id, instrument, direction, entry, stop, target,
             confidence, reasoning_json, feature_snapshot_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [
      id,
      STRATEGY_ID,
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

export interface SweepResult {
  universe: number
  checked: number
  signals: { id: string; symbol: string; bias: string; rr: number }[]
  skippedCooldown: number
  tookMs: number
}

/** One sweep: latest bars over the universe top-N, smc-ict check per symbol. */
export async function runSignalSweep(depth = SCAN_DEPTH): Promise<SweepResult> {
  const started = Date.now()
  const universe = await getActiveUniverse(depth)

  const [bars15mAll, dailyAll, spy15mAll] = await Promise.all([
    fetchBatchBars(universe, "15Min", 4),
    fetchBatchBars(universe, "1Day", 45),
    fetchBatchBars(["SPY"], "15Min", 4),
  ])
  const spyBars = spy15mAll["SPY"] ?? []

  const results: SweepResult = {
    universe: universe.length,
    checked: 0,
    signals: [],
    skippedCooldown: 0,
    tookMs: 0,
  }

  for (const symbol of universe) {
    const bars15m = bars15mAll[symbol] ?? []
    const daily = dailyAll[symbol] ?? []
    if (bars15m.length < 40 || daily.length < 5) continue
    results.checked++

    const sig = checkBotSignal(bars15m, daily, spyBars, bars15m.length - 1, symbol)
    if (!sig) continue

    if (inCooldown(await lastSignalTime(symbol), Date.now())) {
      results.skippedCooldown++
      continue
    }

    const id = await insertSignal(sig)
    results.signals.push({ id, symbol, bias: sig.bias, rr: Number(sig.rr.toFixed(2)) })
  }

  results.tookMs = Date.now() - started
  await auditLog("signal-engine", "signal_sweep_complete", {
    universe: results.universe,
    checked: results.checked,
    found: results.signals.length,
    skippedCooldown: results.skippedCooldown,
    tookMs: results.tookMs,
  }).catch(() => {})
  return results
}
