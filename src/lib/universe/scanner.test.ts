import { describe, it, expect } from "vitest"
import { statsFromBars, passesFilters, scoreUniverse, FILTERS, type SymbolStats } from "./scanner"

const bars = (closes: number[], vol = 1_000_000) =>
  closes.map((c, i) => ({ c, h: c * 1.02, l: c * 0.98, o: c, v: vol, t: `2026-07-0${i + 1}` }))

function stats(overrides: Partial<SymbolStats>): SymbolStats {
  return { symbol: "X", price: 50, avgDollarVolume: 50_000_000, atrPct: 4, changePct: 1, ...overrides }
}

describe("statsFromBars", () => {
  it("computes price, dollar volume, ATR% and change%", () => {
    const s = statsFromBars("TSLA", bars([100, 102, 101, 105]))
    expect(s).not.toBeNull()
    expect(s!.price).toBe(105)
    expect(s!.changePct).toBeCloseTo(((105 - 101) / 101) * 100, 4)
    expect(s!.avgDollarVolume).toBeGreaterThan(0)
    expect(s!.atrPct).toBeGreaterThan(0)
  })

  it("returns null on too few bars or dead price", () => {
    expect(statsFromBars("X", bars([100, 101]))).toBeNull()
    expect(statsFromBars("X", bars([0, 0, 0]))).toBeNull()
  })
})

describe("passesFilters", () => {
  it("enforces price band and dollar-volume floor", () => {
    expect(passesFilters(stats({}))).toBe(true)
    expect(passesFilters(stats({ price: 0.5 }))).toBe(false)
    expect(passesFilters(stats({ price: FILTERS.maxPrice + 1 }))).toBe(false)
    expect(passesFilters(stats({ avgDollarVolume: 1_000_000 }))).toBe(false)
  })
})

describe("scoreUniverse", () => {
  const candidates: SymbolStats[] = [
    stats({ symbol: "LIQVOL", avgDollarVolume: 900_000_000, atrPct: 8, changePct: 6 }),
    stats({ symbol: "SLEEPY", avgDollarVolume: 6_000_000, atrPct: 1.2, changePct: 0.1 }),
    stats({ symbol: "MOVER", avgDollarVolume: 20_000_000, atrPct: 5, changePct: 40 }),
  ]

  it("ranks the liquid+volatile+moving name first, sleepy last", () => {
    const out = scoreUniverse(candidates, new Set())
    expect(out[0].symbol).toBe("LIQVOL")
    expect(out[out.length - 1].symbol).toBe("SLEEPY")
    expect(out[0].rank).toBe(1)
  })

  it("mover bonus lifts today's movers", () => {
    const without = scoreUniverse(candidates, new Set())
    const withBonus = scoreUniverse(candidates, new Set(["MOVER"]))
    const before = without.find(r => r.symbol === "MOVER")!.score
    const after = withBonus.find(r => r.symbol === "MOVER")!.score
    expect(after).toBeGreaterThan(before)
    expect(withBonus.find(r => r.symbol === "MOVER")!.reason).toContain("top mover")
  })

  it("emits human-readable reasons", () => {
    const out = scoreUniverse(candidates, new Set())
    expect(out[0].reason.length).toBeGreaterThan(0)
  })
})
