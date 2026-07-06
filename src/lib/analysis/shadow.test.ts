import { describe, it, expect } from "vitest"
import { simulateSignalOutcome } from "./shadow"

const T0 = Date.parse("2026-07-06T14:00:00Z")
const bar = (minsAfter: number, o: number, h: number, l: number, c: number) => ({
  t: new Date(T0 + minsAfter * 60000).toISOString(), o, h, l, c, v: 1000,
})

const longSig = { direction: "long" as const, entry: 100, stop: 97, target: 106, created_at: T0 }

describe("simulateSignalOutcome", () => {
  it("target hit → +R by distance", () => {
    const out = simulateSignalOutcome(longSig, [bar(15, 100, 107, 99, 106)])
    expect(out).toEqual({ r: 2, exit: "target" })
  })

  it("stop hit → -1R", () => {
    const out = simulateSignalOutcome(longSig, [bar(15, 100, 101, 96, 97)])
    expect(out).toEqual({ r: -1, exit: "stop" })
  })

  it("stop checked before target within the same bar (conservative)", () => {
    const out = simulateSignalOutcome(longSig, [bar(15, 100, 107, 96, 100)])
    expect(out.exit).toBe("stop")
  })

  it("time-stop exits at close with partial R", () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(15 * (i + 1), 100, 101.4, 99.6, 101.5))
    const out = simulateSignalOutcome(longSig, bars)
    expect(out.exit).toBe("time")
    expect(out.r).toBeCloseTo(0.5, 6) // (101.5-100)/3
  })

  it("short signals mirror", () => {
    const shortSig = { direction: "short" as const, entry: 100, stop: 103, target: 94, created_at: T0 }
    expect(simulateSignalOutcome(shortSig, [bar(15, 100, 100.5, 93, 94)])).toEqual({ r: 2, exit: "target" })
    expect(simulateSignalOutcome(shortSig, [bar(15, 100, 104, 99, 103)])).toEqual({ r: -1, exit: "stop" })
  })

  it("no post-signal bars → still open", () => {
    expect(simulateSignalOutcome(longSig, [bar(-15, 100, 101, 99, 100)])).toEqual({ r: null, exit: "open" })
  })

  it("degenerate risk → null", () => {
    expect(simulateSignalOutcome({ ...longSig, stop: 100 }, [bar(15, 100, 101, 99, 100)]).r).toBeNull()
  })
})
