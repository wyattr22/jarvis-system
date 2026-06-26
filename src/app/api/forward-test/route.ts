import { db } from "@/lib/db/client"
import { getBars } from "@/lib/data/alpaca"
import { computeFeatures } from "@/lib/features/engineer"
import { analyzeSMC } from "@/lib/market/smc"

const STRATEGY_SYMBOLS = ["RIOT", "HUT", "MARA", "TSLA", "SQ", "DDOG", "NET", "IONQ"]
const TP_PCT = 0.04
const SL_PCT = 0.03
const MIN_RR = 2.0

export interface ForwardTestResult {
  historical: PerfStats
  recent: PerfStats
  liveSignals: LiveSignal[]
  vsExpected: {
    winRateDelta: number
    avgRDelta: number
    status: "on_track" | "improving" | "degrading"
  }
}

interface PerfStats {
  trades: number
  winRate: number
  avgR: number
  cumR: number
  equityCurve: number[]
}

interface LiveSignal {
  symbol: string
  direction: "long" | "short"
  entry: number
  stop: number
  target: number
  rr: number
  conditions: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function calcStats(rows: any[]): PerfStats {
  if (!rows.length) return { trades: 0, winRate: 0, avgR: 0, cumR: 0, equityCurve: [] }
  const rs = rows.map(t => Number(t.r_multiple))
  const wins = rs.filter(r => r > 0).length
  let cum = 0
  const equityCurve = rs.map(r => { cum += r; return cum })
  return {
    trades: rows.length,
    winRate: wins / rows.length,
    avgR: rs.reduce((s, r) => s + r, 0) / rs.length,
    cumR: cum,
    equityCurve,
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const strategyId = searchParams.get("strategyId") ?? "smc-ict-v4"

  // Load all completed trades
  const tradesRes = await db.execute({
    sql: `SELECT t.r_multiple, t.opened_at, sig.instrument
          FROM trades t
          JOIN signals sig ON t.signal_id = sig.id
          WHERE t.r_multiple IS NOT NULL AND sig.strategy_id = ?
          ORDER BY t.opened_at ASC`,
    args: [strategyId],
  })

  const thirtyDaysAgo = Date.now() - 30 * 86400000
  const allRows = tradesRes.rows
  const recentRows = allRows.filter(t => Number(t.opened_at) > thirtyDaysAgo)

  const historical = calcStats(allRows)
  const recent = calcStats(recentRows)

  const winRateDelta = recent.winRate - historical.winRate
  const avgRDelta = recent.avgR - historical.avgR
  const degrading = recent.trades >= 5 && (winRateDelta < -0.1 || avgRDelta < -0.2)
  const improving = recent.trades >= 5 && (winRateDelta > 0.05 || avgRDelta > 0.1)

  // Live signal scan: check current conditions for strategy symbols
  const liveSignals: LiveSignal[] = []
  const scanSymbols = STRATEGY_SYMBOLS.slice(0, 6)

  await Promise.all(
    scanSymbols.map(async symbol => {
      try {
        const bars = await getBars(symbol, "15Min", 100, 30)
        if (bars.length < 50) return

        const smc = analyzeSMC(bars, symbol)
        const fs = computeFeatures(symbol, bars)
        const f = fs?.features ?? {}

        const rsi = f.rsi_14 ?? 50
        if (rsi < 40 || rsi > 80) return
        if (!f.in_kill_zone) return

        const price = bars[bars.length - 1].c
        const conditions: string[] = []

        if (f.in_kill_zone) conditions.push("kill zone")
        conditions.push(`RSI=${rsi.toFixed(0)}`)

        if (smc.biasDirection === "bullish") {
          const nearFVG = smc.fvgsBelow.some(fvg => Math.abs(price - fvg.high) / price < 0.015)
          const inOTE = smc.oteZone?.direction === "bullish" &&
            price >= smc.oteZone.low && price <= smc.oteZone.high

          if (nearFVG || inOTE) {
            if (nearFVG) conditions.push("FVG support")
            if (inOTE) conditions.push("OTE zone")
            conditions.push("bullish bias")

            const stop = price * (1 - SL_PCT)
            const target = price * (1 + TP_PCT)
            const rr = (target - price) / (price - stop)
            if (rr >= MIN_RR) {
              liveSignals.push({ symbol, direction: "long", entry: price, stop, target, rr, conditions })
            }
          }
        }

        if (smc.biasDirection === "bearish") {
          const nearFVG = smc.fvgsAbove.some(fvg => Math.abs(price - fvg.low) / price < 0.015)
          const inOTE = smc.oteZone?.direction === "bearish" &&
            price >= smc.oteZone.low && price <= smc.oteZone.high

          if (nearFVG || inOTE) {
            if (nearFVG) conditions.push("FVG resistance")
            if (inOTE) conditions.push("OTE zone")
            conditions.push("bearish bias")

            const stop = price * (1 + SL_PCT)
            const target = price * (1 - TP_PCT)
            const rr = (price - target) / (stop - price)
            if (rr >= MIN_RR) {
              liveSignals.push({ symbol, direction: "short", entry: price, stop, target, rr, conditions })
            }
          }
        }
      } catch { /* skip failed symbols */ }
    })
  )

  return Response.json({
    historical,
    recent,
    liveSignals,
    vsExpected: {
      winRateDelta,
      avgRDelta,
      status: degrading ? "degrading" : improving ? "improving" : "on_track",
    },
    scannedAt: new Date().toISOString(),
  } satisfies ForwardTestResult & { scannedAt: string })
}
