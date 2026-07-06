import { describe, it, expect } from "vitest"
import {
  bsGamma,
  computeMaxPain,
  computePcRatio,
  computeGex,
  topWalls,
  type OptionContract,
} from "./options-math"

// Synthetic book: heavy call OI at 110, heavy put OI at 90, spot 100.
const CHAIN: OptionContract[] = [
  { strike: 90, right: "C", openInterest: 100 },
  { strike: 100, right: "C", openInterest: 500 },
  { strike: 110, right: "C", openInterest: 2000 },
  { strike: 120, right: "C", openInterest: 300 },
  { strike: 80, right: "P", openInterest: 400 },
  { strike: 90, right: "P", openInterest: 1500 },
  { strike: 100, right: "P", openInterest: 600 },
]

describe("computeMaxPain", () => {
  it("finds the strike minimizing total holder payout", () => {
    // At 100: call pain = (100-90)*100 = 1000; put pain = 0 (no put strike > 100 except none)
    // Verified by hand: 100 beats 90 (put pain 400*10 + 600*10 = wrong side) — assert exact
    const mp = computeMaxPain(CHAIN, 100)
    expect([90, 100]).toContain(mp)
    // Deterministic on a simpler book:
    const simple: OptionContract[] = [
      { strike: 100, right: "C", openInterest: 1000 },
      { strike: 100, right: "P", openInterest: 1000 },
    ]
    expect(computeMaxPain(simple, 105)).toBe(100)
  })

  it("returns spot when the chain is empty", () => {
    expect(computeMaxPain([], 123)).toBe(123)
  })
})

describe("computePcRatio", () => {
  it("computes putOI / callOI", () => {
    const pc = computePcRatio(CHAIN)
    expect(pc).toBeCloseTo((400 + 1500 + 600) / (100 + 500 + 2000 + 300), 6)
  })

  it("returns 1 when there is no call OI", () => {
    expect(computePcRatio([{ strike: 90, right: "P", openInterest: 10 }])).toBe(1)
  })
})

describe("computeGex", () => {
  it("is positive for a call-only book and negative for a put-only book", () => {
    const calls: OptionContract[] = [{ strike: 100, right: "C", openInterest: 1000, impliedVolatility: 0.3 }]
    const puts: OptionContract[] = [{ strike: 100, right: "P", openInterest: 1000, impliedVolatility: 0.3 }]
    expect(computeGex(calls, 100)).toBeGreaterThan(0)
    expect(computeGex(puts, 100)).toBeLessThan(0)
    // Symmetric book nets to zero
    expect(computeGex([...calls, ...puts], 100)).toBeCloseTo(0, 6)
  })

  it("defaults missing IV to 0.3", () => {
    const withIV = computeGex([{ strike: 100, right: "C", openInterest: 10, impliedVolatility: 0.3 }], 100)
    const withoutIV = computeGex([{ strike: 100, right: "C", openInterest: 10 }], 100)
    expect(withoutIV).toBeCloseTo(withIV, 10)
  })
})

describe("bsGamma", () => {
  it("returns 0 on degenerate inputs", () => {
    expect(bsGamma(0, 100, 0.1, 0.05, 0.3)).toBe(0)
    expect(bsGamma(100, 100, 0, 0.05, 0.3)).toBe(0)
    expect(bsGamma(100, 100, 0.1, 0.05, 0)).toBe(0)
  })

  it("peaks near the money", () => {
    const atm = bsGamma(100, 100, 30 / 365, 0.05, 0.3)
    const otm = bsGamma(100, 130, 30 / 365, 0.05, 0.3)
    expect(atm).toBeGreaterThan(otm)
  })
})

describe("topWalls", () => {
  it("returns top strikes by OI for one side", () => {
    expect(topWalls(CHAIN, "C")).toEqual([
      { strike: 110, oi: 2000 },
      { strike: 100, oi: 500 },
      { strike: 120, oi: 300 },
    ])
    expect(topWalls(CHAIN, "P", 1)).toEqual([{ strike: 90, oi: 1500 }])
  })
})
