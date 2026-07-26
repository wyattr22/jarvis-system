// Parity proof (Phase 16): the rule-engine interpreter running
// SMC_ICT_V4_DEFINITION must agree with the legacy hardcoded
// checkBotSignal(..., DEFAULT_PARAMS) at every bar, across many random
// synthetic price paths — both call the exact same extracted indicator
// primitives now, so any divergence here means a wiring bug in the
// interpreter (wrong order, wrong direction, off-by-one, etc.), not a
// difference in the underlying math.
//
// Scope: bias/price/sl/tp/rr/dol/rsi/slDist and the tag arrays are compared
// exactly. See interpreter.ts's file comment for why tag *grouping* is a
// presentational detail, not a decision-relevant one — for this specific
// legacy definition it happens to reproduce the split exactly anyway.

import { describe, it, expect } from "vitest"
import { checkBotSignal, DEFAULT_PARAMS } from "@/lib/backtest/bot-strategy"
import type { Bar } from "@/lib/strategy-engine/indicators"
import { evaluateStrategy } from "./interpreter"
import { SMC_ICT_V4_DEFINITION } from "./legacy-definition"

// Tiny seedable PRNG (mulberry32) for reproducible synthetic price paths.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pad(n: number): string { return String(n).padStart(2, "0") }

function dateFor(dayIndex: number): string {
  // Simple sequential calendar, weekends included — the algorithm doesn't
  // care about real trading calendars, only relative bar ordering.
  const base = new Date(Date.UTC(2026, 0, 1))
  base.setUTCDate(base.getUTCDate() + dayIndex)
  return base.toISOString().slice(0, 10)
}

/** Generates DAY_COUNT days of daily bars + 15m intraday bars for the last
 *  INTRADAY_DAYS of them, as a single internally-consistent random walk. */
function generateSynthetic(rand: () => number, dayCount = 60, intradayDays = 20) {
  const dailyBars: Bar[] = []
  const bars15m: Bar[] = []
  const spyBars: Bar[] = []
  let price = 20 + rand() * 30

  for (let d = 0; d < dayCount; d++) {
    const date = dateFor(d)
    const dayOpen = price
    // Occasional larger directional day to create real swing structure.
    const bigMove = rand() < 0.15
    const drift = (rand() - 0.5) * (bigMove ? 3 : 1)
    const dayCloseTarget = dayOpen * (1 + drift * 0.02)

    const isIntradayDay = d >= dayCount - intradayDays
    const barsPerDay = isIntradayDay ? 26 : 1
    let dayHigh = -Infinity, dayLow = Infinity
    let cur = dayOpen

    for (let b = 0; b < barsPerDay; b++) {
      const t = (dayOpen + (dayCloseTarget - dayOpen) * ((b + 1) / barsPerDay))
      const noise = (rand() - 0.5) * dayOpen * 0.006
      // Occasional gap to seed FVG/order-block/breaker detectors.
      const gap = rand() < 0.08 ? (rand() - 0.5) * dayOpen * 0.01 : 0
      const o = cur
      const c = t + noise + gap
      const h = Math.max(o, c) + Math.abs(noise) * (0.3 + rand())
      const l = Math.min(o, c) - Math.abs(noise) * (0.3 + rand())
      const v = 500_000 + rand() * 1_500_000
      dayHigh = Math.max(dayHigh, h); dayLow = Math.min(dayLow, l)
      cur = c

      if (isIntradayDay) {
        const hh = Math.floor((9.5 * 60 + b * 15) / 60)
        const mm = (9.5 * 60 + b * 15) % 60
        bars15m.push({ t: `${date}T${pad(hh)}:${pad(mm)}:00Z`, o, h, l, c, v })
      }
    }

    dailyBars.push({ t: `${date}T00:00:00Z`, o: dayOpen, h: dayHigh, l: dayLow, c: cur, v: 0 })
    price = cur
  }

  // SPY: gentle, low-amplitude noise around a flat baseline so
  // requireSpyAlignment stays 'neutral' and doesn't confound the parity
  // check with a filter path that's identical shared code anyway
  // (getSpyTrend is one of the extracted primitives both sides call).
  let spyPrice = 500
  for (const b of dailyBars) {
    const dateOnly = b.t.slice(0, 10)
    for (let m = 0; m < 26; m++) {
      const hh = Math.floor((9.5 * 60 + m * 15) / 60)
      const mm = (9.5 * 60 + m * 15) % 60
      const noise = (rand() - 0.5) * spyPrice * 0.0005
      spyPrice += noise
      spyBars.push({
        t: `${dateOnly}T${pad(hh)}:${pad(mm)}:00Z`,
        o: spyPrice, h: spyPrice + 0.1, l: spyPrice - 0.1, c: spyPrice, v: 1_000_000,
      })
    }
  }

  return { dailyBars, bars15m, spyBars }
}

describe("interpreter/legacy parity", () => {
  const seeds = [1, 42, 1337, 90210, 7]
  let nonNullMatches = 0

  for (const seed of seeds) {
    it(`matches checkBotSignal bar-for-bar (seed ${seed})`, () => {
      const rand = mulberry32(seed)
      const { dailyBars, bars15m, spyBars } = generateSynthetic(rand)

      for (let i = 0; i < bars15m.length; i++) {
        const legacy = checkBotSignal(bars15m, dailyBars, spyBars, i, "TEST", DEFAULT_PARAMS)
        const interpreted = evaluateStrategy(SMC_ICT_V4_DEFINITION, {
          bars15m, dailyBars, spyBars, i, symbol: "TEST",
        })

        if (legacy === null || interpreted === null) {
          expect(interpreted, `mismatch at bar ${i} (seed ${seed}): legacy=${JSON.stringify(legacy)} interpreted=${JSON.stringify(interpreted)}`)
            .toBe(legacy)
          continue
        }

        nonNullMatches++
        expect(interpreted.bias).toBe(legacy.bias)
        expect(interpreted.price).toBe(legacy.price)
        expect(interpreted.rsi).toBe(legacy.rsi)
        expect(interpreted.sl).toBe(legacy.sl)
        expect(interpreted.tp).toBe(legacy.tp)
        expect(interpreted.rr).toBe(legacy.rr)
        expect(interpreted.dol).toBe(legacy.dol)
        expect(interpreted.slDist).toBe(legacy.slDist)
        expect(interpreted.revTags).toEqual(legacy.revTags)
        expect(interpreted.contTags).toEqual(legacy.contTags)
      }
    })
  }

  it("the test actually exercised at least one real (non-null) signal across all seeds", () => {
    // Guards against a vacuously-passing test where both sides just always
    // return null and "parity" would be trivially true.
    expect(nonNullMatches).toBeGreaterThan(0)
  })
})
