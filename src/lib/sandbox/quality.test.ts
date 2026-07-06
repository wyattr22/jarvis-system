// Pure-function tests for the confidence-score math.
// DB-backed paths (evaluateSource end-to-end, source_quality table writes)
// are integration-tested separately.

import { describe, it, expect, beforeEach } from "vitest"
import { _testHelpers } from "./quality"

const { scoreConfidence, passRate, recordOutcome } = _testHelpers

// Fake source spec for math testing
const fakeSpec = {
  name: "test.source",
  maxAgeMs: 60_000,
  validate: () => ({ ok: true }),
}

beforeEach(() => {
  // Reset trackRecord by recording 100 misses then resetting via fresh name
})

describe("scoreConfidence", () => {
  it("returns 0 when validation fails", () => {
    const score = scoreConfidence(fakeSpec, false, 0, "fresh-source-1")
    expect(score).toBe(0)
  })

  it("gives high score when fresh + passing", () => {
    const score = scoreConfidence(fakeSpec, true, 0, "fresh-source-2")
    // freshness=1.0 × 0.5 + track=0.5 (no history) × 0.3 + 0.2 = 0.85
    expect(score).toBeCloseTo(0.85, 1)
  })

  it("decays score linearly with freshness", () => {
    const halfStale = scoreConfidence(fakeSpec, true, 30_000, "fresh-source-3")
    const veryStale = scoreConfidence(fakeSpec, true, 60_000, "fresh-source-4")
    expect(halfStale).toBeLessThan(0.85)
    expect(veryStale).toBeLessThan(halfStale)
  })

  it("clamps to [0, 1]", () => {
    const negative = scoreConfidence({ ...fakeSpec, maxAgeMs: 1 }, true, 10_000, "fresh-source-5")
    expect(negative).toBeGreaterThanOrEqual(0)
    expect(negative).toBeLessThanOrEqual(1)
  })
})

describe("passRate + recordOutcome", () => {
  it("returns 0.5 (neutral) for unknown sources", () => {
    expect(passRate("never-seen-before")).toBe(0.5)
  })

  it("reflects recorded outcomes", () => {
    const name = "track-record-test-1"
    recordOutcome(name, true)
    recordOutcome(name, true)
    recordOutcome(name, false)
    // 2/3 success rate
    expect(passRate(name)).toBeCloseTo(2/3, 3)
  })

  it("track record raises score on subsequent evaluations", () => {
    const name = "track-record-test-2"
    // Build a perfect track record
    for (let i = 0; i < 10; i++) recordOutcome(name, true)
    const score = scoreConfidence(fakeSpec, true, 0, name)
    // freshness=1.0 × 0.5 + track=1.0 × 0.3 + 0.2 = 1.0 (capped)
    expect(score).toBeCloseTo(1.0, 1)
  })

  it("caps at 100-entry circular buffer", () => {
    const name = "track-record-test-3"
    // Push 110 false then 5 true
    for (let i = 0; i < 110; i++) recordOutcome(name, false)
    for (let i = 0; i < 5; i++) recordOutcome(name, true)
    // Only last 100 retained: 95 false + 5 true → 0.05 pass rate
    expect(passRate(name)).toBeCloseTo(0.05, 2)
  })
})
