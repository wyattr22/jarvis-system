import { describe, it, expect } from "vitest"
import { buildPlan } from "./scorer"
import { DEFAULT_RISK_CONFIG } from "./risk-config"
import type { Opportunity } from "@/lib/opportunities/store"
import type { Position } from "@/lib/brokers/adapter"

function opp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: `opp_${Math.random().toString(36).slice(2, 7)}`,
    source: "test",
    asset_class: "equity",
    instrument: "TEST",
    side: "long",
    thesis: "test",
    entry_hint: 100,
    stop_hint: 95,
    win_prob: 0.6,
    expected_r: 2,
    confidence: 0.7,
    status: "open",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

const NO_POSITIONS: Position[] = []
const EQUITY = 100_000

describe("buildPlan — ranking", () => {
  it("ranks higher-score opportunities first", () => {
    const a = opp({ instrument: "AAA", expected_r: 3, win_prob: 0.7, confidence: 0.9 })
    const b = opp({ instrument: "BBB", expected_r: 1, win_prob: 0.5, confidence: 0.5 })
    const plan = buildPlan([b, a], NO_POSITIONS, EQUITY, DEFAULT_RISK_CONFIG)
    expect(plan.rows[0].opportunity.instrument).toBe("AAA")
    expect(plan.rows[1].opportunity.instrument).toBe("BBB")
  })
})

describe("buildPlan — caps", () => {
  it("blocks beyond max_open_positions", () => {
    const config = { ...DEFAULT_RISK_CONFIG, max_open_positions: 2 }
    const opps = Array.from({ length: 5 }, (_, i) => opp({ instrument: `T${i}` }))
    const plan = buildPlan(opps, NO_POSITIONS, EQUITY, config)
    expect(plan.approved_count).toBe(2)
    expect(plan.rows.filter(r => r.status === "risk_blocked")).toHaveLength(3)
  })

  it("blocks duplicate of already-held instrument", () => {
    const held: Position[] = [
      { symbol: "TSLA", qty: 10, avg_entry_price: 250, unrealized_pl: 0, side: "long" },
    ]
    const o = opp({ instrument: "TSLA" })
    const plan = buildPlan([o], held, EQUITY, DEFAULT_RISK_CONFIG)
    expect(plan.rows[0].status).toBe("risk_blocked")
    expect(plan.rows[0].block_reason).toMatch(/already holding TSLA/)
  })

  it("blocks when asset-class cap would be exceeded", () => {
    // Squeeze the asset-class cap so even small allocations exceed it.
    // Three opps, each sized to ~$10k (Kelly-capped). Class cap = 5%
    // = $5,000 → only the first can fit.
    const config = {
      ...DEFAULT_RISK_CONFIG,
      max_open_positions: 100,
      asset_class_caps: { ...DEFAULT_RISK_CONFIG.asset_class_caps, equity: 0.05 },
    }
    const a = opp({ instrument: "AAA" })
    const b = opp({ instrument: "BBB" })
    const c = opp({ instrument: "CCC" })
    const plan = buildPlan([a, b, c], NO_POSITIONS, EQUITY, config)
    expect(plan.approved_count).toBeLessThanOrEqual(1)
    expect(plan.rows.filter(r => r.block_reason?.includes("equity cap"))).not.toHaveLength(0)
  })

  it("marks missing entry/stop as missing_data", () => {
    const o = opp({ entry_hint: undefined })
    const plan = buildPlan([o], NO_POSITIONS, EQUITY, DEFAULT_RISK_CONFIG)
    expect(plan.rows[0].status).toBe("missing_data")
  })

  it("computes total_dollar_at_risk only from approved rows", () => {
    // Strip win_prob + expected_r so Kelly is skipped and the risk cap binds.
    // Per-share risk = $5, max dollar risk = 1% of $100k = $1000 → 200 shares
    // → dollar risk = 200 × $5 = $1000.
    const o1 = opp({ instrument: "AAA", win_prob: undefined, expected_r: undefined })
    const o2 = opp({ instrument: "BBB", entry_hint: undefined })
    const plan = buildPlan([o1, o2], NO_POSITIONS, EQUITY, DEFAULT_RISK_CONFIG)
    expect(plan.approved_count).toBe(1)
    expect(plan.total_dollar_at_risk).toBeCloseTo(1000, 5)
  })
})
