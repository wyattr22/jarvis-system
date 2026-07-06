// Shadow vs live comparison (12.7).
//
// "Shadow" = what EVERY signal would have earned if taken (simulated against
// real bars after signal time). "Live" = what the executed trades actually
// earned. The gap answers: is the bot leaving R on the table (signals not
// executed) or being saved by its filters (signals that would have lost)?

import { safeFetch } from "@/lib/sandbox/whitelist"
import { db } from "@/lib/db/client"

const DATA_BASE = "https://data.alpaca.markets/v2"
const MAX_HOLD_BARS = 20 // mirror the backtest exit rule (~5h on 15m)

export interface ShadowSignal {
  id: string
  instrument: string
  direction: "long" | "short"
  entry: number
  stop: number
  target: number | null
  created_at: number
  executed: boolean
  live_r: number | null
  shadow_r: number | null
  shadow_exit: "stop" | "target" | "time" | "open" | null
}

interface Bar15 { t: string; o: number; h: number; l: number; c: number; v: number }

function headers() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  }
}

/**
 * Pure: simulate one signal's hypothetical outcome against post-signal bars.
 * Mirrors the backtester's exit rules: stop = -1R, target = +R by distance,
 * time-stop after MAX_HOLD_BARS exits at close, not-enough-bars = still open.
 */
export function simulateSignalOutcome(
  sig: { direction: "long" | "short"; entry: number; stop: number; target: number | null; created_at: number },
  bars: Bar15[],
  maxHoldBars = MAX_HOLD_BARS,
): { r: number | null; exit: "stop" | "target" | "time" | "open" } {
  const risk = Math.abs(sig.entry - sig.stop)
  if (risk <= 0) return { r: null, exit: "open" }
  const after = bars.filter(b => new Date(b.t).getTime() > sig.created_at)
  if (!after.length) return { r: null, exit: "open" }

  const rewardR = sig.target !== null ? Math.abs(sig.target - sig.entry) / risk : null
  let held = 0
  for (const bar of after) {
    held++
    if (sig.direction === "long") {
      if (bar.l <= sig.stop) return { r: -1, exit: "stop" }
      if (sig.target !== null && bar.h >= sig.target) return { r: rewardR!, exit: "target" }
    } else {
      if (bar.h >= sig.stop) return { r: -1, exit: "stop" }
      if (sig.target !== null && bar.l <= sig.target) return { r: rewardR!, exit: "target" }
    }
    if (held >= maxHoldBars) {
      const dir = sig.direction === "long" ? 1 : -1
      return { r: (dir * (bar.c - sig.entry)) / risk, exit: "time" }
    }
  }
  return { r: null, exit: "open" }
}

async function fetchBarsSince(symbols: string[], sinceMs: number): Promise<Record<string, Bar15[]>> {
  const out: Record<string, Bar15[]> = {}
  const start = new Date(sinceMs).toISOString().split("T")[0]
  for (let i = 0; i < symbols.length; i += 50) {
    const batch = symbols.slice(i, i + 50)
    try {
      const url = `${DATA_BASE}/stocks/bars?symbols=${encodeURIComponent(batch.join(","))}` +
        `&timeframe=15Min&start=${start}&feed=iex&limit=10000`
      const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(20000) })
      if (!res.ok) continue
      const json = await res.json()
      Object.assign(out, json.bars ?? {})
    } catch { /* partial data beats none */ }
  }
  return out
}

export interface ShadowComparison {
  days: number
  signals: ShadowSignal[]
  shadow: { count: number; wins: number; totalR: number; winRate: number }
  live: { count: number; wins: number; totalR: number; winRate: number }
  missedR: number // shadow R from signals that were never executed
  curve: { t: number; shadowR: number; liveR: number }[]
}

export async function getShadowComparison(days = 30): Promise<ShadowComparison> {
  const since = Date.now() - days * 86400000

  const sigRes = await db.execute({
    sql: `SELECT s.id, s.instrument, s.direction, s.entry, s.stop, s.target, s.created_at,
                 t.r_multiple AS live_r
          FROM signals s
          LEFT JOIN trades t ON t.signal_id = s.id
          WHERE s.created_at > ? AND s.entry IS NOT NULL AND s.stop IS NOT NULL
          ORDER BY s.created_at ASC`,
    args: [since],
  })

  const raw = sigRes.rows.map(r => ({
    id: String(r.id),
    instrument: String(r.instrument),
    direction: (String(r.direction) === "short" ? "short" : "long") as "long" | "short",
    entry: Number(r.entry),
    stop: Number(r.stop),
    target: r.target !== null ? Number(r.target) : null,
    created_at: Number(r.created_at),
    live_r: r.live_r !== null ? Number(r.live_r) : null,
  }))

  const symbols = [...new Set(raw.map(s => s.instrument))]
  const barsBySymbol = symbols.length ? await fetchBarsSince(symbols, since) : {}

  const signals: ShadowSignal[] = raw.map(s => {
    const sim = simulateSignalOutcome(s, barsBySymbol[s.instrument] ?? [])
    return {
      ...s,
      executed: s.live_r !== null,
      shadow_r: sim.r,
      shadow_exit: sim.exit,
    }
  })

  const closedShadow = signals.filter(s => s.shadow_r !== null)
  const executed = signals.filter(s => s.live_r !== null)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  let shadowCum = 0
  let liveCum = 0
  const curve = signals.map(s => {
    shadowCum += s.shadow_r ?? 0
    liveCum += s.live_r ?? 0
    return { t: s.created_at, shadowR: Number(shadowCum.toFixed(2)), liveR: Number(liveCum.toFixed(2)) }
  })

  return {
    days,
    signals,
    shadow: {
      count: closedShadow.length,
      wins: closedShadow.filter(s => (s.shadow_r ?? 0) > 0).length,
      totalR: Number(sum(closedShadow.map(s => s.shadow_r!)).toFixed(2)),
      winRate: closedShadow.length ? closedShadow.filter(s => (s.shadow_r ?? 0) > 0).length / closedShadow.length : 0,
    },
    live: {
      count: executed.length,
      wins: executed.filter(s => (s.live_r ?? 0) > 0).length,
      totalR: Number(sum(executed.map(s => s.live_r!)).toFixed(2)),
      winRate: executed.length ? executed.filter(s => (s.live_r ?? 0) > 0).length / executed.length : 0,
    },
    missedR: Number(sum(signals.filter(s => !s.executed && s.shadow_r !== null).map(s => s.shadow_r!)).toFixed(2)),
    curve,
  }
}
