// Lightweight tests for the opportunities store helpers that DON'T need a DB.
// Full integration tests (ingestion/dedup/list) need a real Turso connection
// and land alongside Phase 4 when allocator coverage matters.

import { describe, it, expect } from "vitest"
import type { OpportunityInput } from "./store"

describe("OpportunityInput shape", () => {
  it("compiles with minimum required fields", () => {
    const minimal: OpportunityInput = {
      source: "splitwatch",
      asset_class: "equity",
      instrument: "GME",
      side: "long",
      thesis: "Reverse split rounding-up arbitrage",
    }
    expect(minimal.source).toBe("splitwatch")
  })

  it("accepts all optional fields", () => {
    const full: OpportunityInput = {
      source: "swing",
      asset_class: "equity",
      instrument: "TSLA",
      side: "long",
      thesis: "Pullback to OB on daily uptrend",
      expected_r: 2.5,
      win_prob: 0.55,
      horizon_days: 5,
      entry_hint: 245.5,
      stop_hint: 240.0,
      size_hint: 10,
      confidence: 0.7,
      expires_at: Date.now() + 86_400_000,
      source_payload: { setup: "OB+BOS", timeframe: "1D" },
    }
    expect(full.expected_r).toBe(2.5)
    expect(full.source_payload?.setup).toBe("OB+BOS")
  })
})
