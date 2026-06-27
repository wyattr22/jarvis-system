// Pure-function unit tests for the Kelly-capped sizer.

import { describe, it, expect } from "vitest"
import { kellyFraction, sizeOpportunity } from "./sizer"
import { DEFAULT_RISK_CONFIG } from "./risk-config"
import type { Opportunity } from "@/lib/opportunities/store"

function fakeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp_test",
    source: "test",
    asset_class: "equity",
    instrument: "TEST",
    side: "long",
    thesis: "test",
    status: "open",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

describe("kellyFraction", () => {
  it("returns 0 when win_prob is at boundaries", () => {
    expect(kellyFraction(0, 2)).toBe(0)
    expect(kellyFraction(1, 2)).toBe(0)
  })

  it("returns 0 when expected_r is non-positive", () => {
    expect(kellyFraction(0.6, 0)).toBe(0)
    expect(kellyFraction(0.6, -1)).toBe(0)
  })

  it("returns 0 for negative-edge bets", () => {
    // p=0.3, b=2 → (0.3×2 - 0.7)/2 = -0.05 → clipped to 0
    expect(kellyFraction(0.3, 2)).toBe(0)
  })

  it("returns expected positive fraction for positive-edge bets", () => {
    // p=0.6, b=2 → (1.2 - 0.4)/2 = 0.4
    expect(kellyFraction(0.6, 2)).toBeCloseTo(0.4, 5)
  })
})

describe("sizeOpportunity — guard rails", () => {
  it("rejects when entry_hint missing", () => {
    const r = sizeOpportunity(fakeOpp({ stop_hint: 95 }), 100_000, DEFAULT_RISK_CONFIG)
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/entry_hint or stop_hint/)
  })

  it("rejects when stop_hint missing", () => {
    const r = sizeOpportunity(fakeOpp({ entry_hint: 100 }), 100_000, DEFAULT_RISK_CONFIG)
    expect(r.approved).toBe(false)
  })

  it("rejects on zero-distance stop", () => {
    const r = sizeOpportunity(fakeOpp({ entry_hint: 100, stop_hint: 100 }), 100_000, DEFAULT_RISK_CONFIG)
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/zero-distance/)
  })

  it("rejects on non-positive equity", () => {
    const r = sizeOpportunity(fakeOpp({ entry_hint: 100, stop_hint: 95 }), 0, DEFAULT_RISK_CONFIG)
    expect(r.approved).toBe(false)
  })
})

describe("sizeOpportunity — risk cap math", () => {
  it("at $100k equity + 1% per-trade cap, $5 stop distance → 200 shares max from risk cap alone", () => {
    // Without win_prob/expected_r, Kelly is skipped and risk cap binds.
    const r = sizeOpportunity(
      fakeOpp({ entry_hint: 100, stop_hint: 95 }),
      100_000,
      DEFAULT_RISK_CONFIG,
    )
    // Max dollar risk = 100,000 × 0.01 = 1,000. 1000 / 5 = 200 shares.
    expect(r.approved).toBe(true)
    expect(r.size).toBe(200)
    expect(r.dollar_risk).toBeCloseTo(1000, 5)
    expect(r.dollar_amount).toBe(200 * 100)
    expect(r.risk_pct_of_equity).toBeCloseTo(0.01, 5)
  })

  it("Kelly cap binds when expected_r + win_prob are favorable", () => {
    // Kelly = (0.7 × 2 - 0.3) / 2 = 0.55, capped at 0.25 → fraction = 0.55 × 0.25 = 0.1375
    // At $100k equity, Kelly dollars = $13,750. At $100 entry → 137 shares.
    // Risk cap: 1000 / 5 = 200 shares. min(137, 200) = 137. → Kelly binds.
    const r = sizeOpportunity(
      fakeOpp({ entry_hint: 100, stop_hint: 95, win_prob: 0.7, expected_r: 2 }),
      100_000,
      DEFAULT_RISK_CONFIG,
    )
    expect(r.approved).toBe(true)
    expect(r.size).toBe(137)
    expect(r.kelly_fraction).toBeCloseTo(0.55, 2)
  })

  it("Risk cap binds when Kelly is very large", () => {
    // Wide stop → small share count regardless of Kelly.
    // entry=100 stop=50 → per-share risk $50. 1000/50 = 20 shares.
    const r = sizeOpportunity(
      fakeOpp({ entry_hint: 100, stop_hint: 50, win_prob: 0.9, expected_r: 5 }),
      100_000,
      DEFAULT_RISK_CONFIG,
    )
    expect(r.approved).toBe(true)
    expect(r.size).toBe(20)
  })

  it("Zero size when Kelly says negative edge", () => {
    // p=0.3, b=1 → kelly = (0.3 - 0.7)/1 = -0.4 → 0.
    // Kelly-based size = 0. Risk cap still says 200 (entry=100 stop=95).
    // min(200, 0) = 0 → rejected.
    const r = sizeOpportunity(
      fakeOpp({ entry_hint: 100, stop_hint: 95, win_prob: 0.3, expected_r: 1 }),
      100_000,
      DEFAULT_RISK_CONFIG,
    )
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/size = 0/)
  })
})
