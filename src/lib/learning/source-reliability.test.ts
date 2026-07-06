import { describe, it, expect } from "vitest"
import { _computeScoreForTesting } from "./source-reliability"

describe("computeScore", () => {
  it("returns neutral 0.5 for tiny samples", () => {
    expect(_computeScoreForTesting(2.0, 3, 1.0)).toBe(0.5)
    expect(_computeScoreForTesting(-1.0, 4, 0.0)).toBe(0.5)
  })

  it("rewards positive avg R with high score", () => {
    const s = _computeScoreForTesting(1.5, 50, 1.0)
    expect(s).toBeGreaterThan(0.75)
  })

  it("penalises negative avg R", () => {
    const s = _computeScoreForTesting(-1.0, 50, 1.0)
    expect(s).toBeLessThan(0.5)
  })

  it("clamps to [0,1]", () => {
    expect(_computeScoreForTesting(1000, 100, 1.0)).toBeLessThanOrEqual(1)
    expect(_computeScoreForTesting(-1000, 100, 0.0)).toBeGreaterThanOrEqual(0)
  })

  it("fill rate contributes 30%", () => {
    const allFill = _computeScoreForTesting(0, 50, 1.0)
    const noFill = _computeScoreForTesting(0, 50, 0.0)
    expect(allFill).toBeGreaterThan(noFill)
    expect(allFill - noFill).toBeCloseTo(0.3, 1)
  })
})
