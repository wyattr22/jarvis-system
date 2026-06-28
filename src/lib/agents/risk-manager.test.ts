// Unit tests for vetoAllocatorPlan (pure function — no LLM, no DB).

import { describe, it, expect } from "vitest"
import { vetoAllocatorPlan } from "./risk-manager"
import { DEFAULT_RISK_CONFIG } from "@/lib/allocator/risk-config"
import type { AllocatorPlan } from "@/lib/allocator/scorer"
import type { Opportunity } from "@/lib/opportunities/store"

function makePlan(overrides: Partial<AllocatorPlan> = {}): AllocatorPlan {
  return {
    equity: 100_000,
    rows: [],
    approved_count: 0,
    total_dollar_at_risk: 0,
    ...overrides,
  }
}

function opp(id: string, overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id,
    source: "test",
    asset_class: "equity",
    instrument: id,
    side: "long",
    thesis: "test",
    status: "open",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

describe("vetoAllocatorPlan — hard caps", () => {
  it("vetoes the whole plan when today's loss already hit the daily cap", () => {
    const plan = makePlan({
      approved_count: 1,
      total_dollar_at_risk: 100,
      rows: [{
        opportunity: opp("o1"),
        sizing: { opportunity_id: "o1", approved: true, size: 1, dollar_amount: 100, dollar_risk: 100, kelly_fraction: 0.1, risk_pct_of_equity: 0.001 },
        score: 1,
        status: "approved",
      }],
    })
    // 3% of $100k = $3000 cap. Today's loss = $3500 → already past.
    const r = vetoAllocatorPlan(plan, DEFAULT_RISK_CONFIG, -3500)
    expect(r.verdict).toBe("veto")
    expect(r.reason).toMatch(/daily loss/)
    expect(r.per_opportunity[0].allow).toBe(false)
  })

  it("vetoes when projected worst-case would exceed daily loss cap", () => {
    const plan = makePlan({
      approved_count: 1,
      total_dollar_at_risk: 2500,
      rows: [{
        opportunity: opp("o1"),
        sizing: { opportunity_id: "o1", approved: true, size: 1, dollar_amount: 100, dollar_risk: 2500, kelly_fraction: 0.1, risk_pct_of_equity: 0.025 },
        score: 1,
        status: "approved",
      }],
    })
    // -$1000 today + worst-case -$2500 = -$3500 > -$3000 cap → veto
    const r = vetoAllocatorPlan(plan, DEFAULT_RISK_CONFIG, -1000)
    expect(r.verdict).toBe("veto")
    expect(r.reason).toMatch(/worst-case/)
  })

  it("blocks individual rows that exceed MAX_RISK_PER_TRADE_PCT (3%)", () => {
    const plan = makePlan({
      approved_count: 1,
      total_dollar_at_risk: 3500,
      rows: [{
        opportunity: opp("hot"),
        sizing: { opportunity_id: "hot", approved: true, size: 1, dollar_amount: 100, dollar_risk: 3500, kelly_fraction: 0.1, risk_pct_of_equity: 0.035 },
        score: 1,
        status: "approved",
      }],
    })
    // Daily cap not yet hit; this row's risk_pct = 3.5% > 3% hard cap → block.
    const r = vetoAllocatorPlan(plan, { ...DEFAULT_RISK_CONFIG, max_daily_loss_pct: 0.1 }, 0)
    expect(r.per_opportunity[0].allow).toBe(false)
    expect(r.per_opportunity[0].reason).toMatch(/3.50%/)
  })
})

describe("vetoAllocatorPlan — approvals + warnings", () => {
  it("approves clean plan with no warnings", () => {
    const plan = makePlan({
      approved_count: 1,
      total_dollar_at_risk: 500,
      rows: [{
        opportunity: opp("o1"),
        sizing: { opportunity_id: "o1", approved: true, size: 1, dollar_amount: 100, dollar_risk: 500, kelly_fraction: 0.1, risk_pct_of_equity: 0.005 },
        score: 1,
        status: "approved",
      }],
    })
    const r = vetoAllocatorPlan(plan, DEFAULT_RISK_CONFIG, 0)
    expect(r.verdict).toBe("approve")
    expect(r.warnings).toHaveLength(0)
  })

  it("warns when plan opens > half of max_open_positions", () => {
    const config = { ...DEFAULT_RISK_CONFIG, max_open_positions: 4 }
    const rows = Array.from({ length: 3 }, (_, i) => ({
      opportunity: opp(`o${i}`),
      sizing: { opportunity_id: `o${i}`, approved: true, size: 1, dollar_amount: 100, dollar_risk: 100, kelly_fraction: 0.1, risk_pct_of_equity: 0.001 },
      score: 1,
      status: "approved" as const,
    }))
    const plan = makePlan({ approved_count: 3, total_dollar_at_risk: 300, rows })
    const r = vetoAllocatorPlan(plan, config, 0)
    expect(r.verdict).toBe("approve_with_warnings")
    expect(r.warnings.join(" ")).toMatch(/half of max_open_positions/)
  })
})
