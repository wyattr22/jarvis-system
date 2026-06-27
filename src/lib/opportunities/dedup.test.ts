// Pure-function tests for the dedup window math (the rest of ingest needs a DB).

import { describe, it, expect } from "vitest"

// Replicate the dedup logic for unit testing — the production code is in
// findRecentMatch but that's a closure over db.execute, so we test the math
// directly here. If the production formula changes, sync this file.

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000
const DRIFT_THRESHOLD = 0.01

function withinDedupWindow(existing_created_at: number, now: number): boolean {
  return now - existing_created_at <= DEDUP_WINDOW_MS
}

function entryWithinDriftThreshold(existing_entry: number, new_entry: number): boolean {
  const drift = Math.abs(new_entry - existing_entry) / Math.max(1e-9, Math.abs(existing_entry))
  return drift < DRIFT_THRESHOLD
}

describe("dedup window", () => {
  it("treats new opp as duplicate within 24h", () => {
    const now = Date.now()
    expect(withinDedupWindow(now - 60_000, now)).toBe(true)              // 1 min ago
    expect(withinDedupWindow(now - 23 * 3600_000, now)).toBe(true)      // 23h ago
  })

  it("treats new opp as fresh after 24h", () => {
    const now = Date.now()
    expect(withinDedupWindow(now - 25 * 3600_000, now)).toBe(false)      // 25h ago
  })
})

describe("entry drift threshold", () => {
  it("0.5% drift is within threshold", () => {
    expect(entryWithinDriftThreshold(100, 100.5)).toBe(true)
  })

  it("1.5% drift is outside threshold", () => {
    expect(entryWithinDriftThreshold(100, 101.5)).toBe(false)
  })

  it("0% drift (identical) is within threshold", () => {
    expect(entryWithinDriftThreshold(250, 250)).toBe(true)
  })

  it("handles tiny entry prices safely", () => {
    expect(entryWithinDriftThreshold(0.0001, 0.000101)).toBe(true)
  })
})
