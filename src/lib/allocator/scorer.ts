// Portfolio scorer — takes a batch of open opportunities + current positions
// + risk config, returns a ranked plan.
//
// Two stages:
//   1. Score each opportunity. Score = expected_r × win_prob × confidence.
//      Missing values default conservatively (expected_r=1, win_prob=0.5,
//      confidence=0.5) so weak setups don't game the ranking.
//   2. Filter out opportunities that violate caps:
//      - asset class % of equity (after this opp's allocation)
//      - max open positions
//      - already-held instrument (no double-up)
//
// Output: ranked list of { opportunity, sizing, score, status }.
// `status`:
//   "approved"    — passed all filters, ready for review
//   "risk_blocked"— failed a risk cap
//   "size_zero"   — sizer returned zero (negative edge or impossible)
//   "missing_data"— couldn't score (no entry/stop)

import type { Opportunity } from "@/lib/opportunities/store"
import type { Position } from "@/lib/brokers/adapter"
import type { RiskConfig } from "./risk-config"
import { sizeOpportunity, type SizingResult } from "./sizer"

export type PlanRow = {
  opportunity: Opportunity
  sizing: SizingResult
  score: number
  status: "approved" | "risk_blocked" | "size_zero" | "missing_data"
  block_reason?: string
}

export type AllocatorPlan = {
  equity: number
  rows: PlanRow[]
  approved_count: number
  total_dollar_at_risk: number
}

// Optional per-source multiplier supplied from source_reliability table.
// Defaults to 1.0 when reliability is unknown so existing tests don't shift.
function scoreOf(opp: Opportunity, reliabilityByName?: Map<string, number>): number {
  const r   = opp.expected_r ?? 1.0
  const p   = opp.win_prob   ?? 0.5
  const c   = opp.confidence ?? 0.5
  const rel = reliabilityByName?.get(opp.source) ?? 1.0
  return r * p * c * rel
}

export function buildPlan(
  opportunities: Opportunity[],
  positions: Position[],
  equity: number,
  config: RiskConfig,
  /** Optional per-source reliability multiplier (from source_reliability table). */
  reliabilityByName?: Map<string, number>,
): AllocatorPlan {
  const heldSymbols = new Set(positions.map(p => p.symbol.toUpperCase()))
  const openCount   = positions.length

  // Running totals so we can apply caps across the whole plan
  const assetClassExposure: Record<string, number> = {}
  for (const p of positions) {
    // Without per-position asset class info we treat all existing positions
    // as equity (Alpaca-only today). This becomes accurate once Phase 3
    // adapters tag positions with their asset class.
    assetClassExposure.equity = (assetClassExposure.equity ?? 0) + Math.abs(p.qty * p.avg_entry_price)
  }

  let approvedCount = 0
  let totalRisk     = 0
  let projectedOpen = openCount

  // Sort by raw score descending so the strongest setups get capacity first
  const sorted = [...opportunities].sort(
    (a, b) => scoreOf(b, reliabilityByName) - scoreOf(a, reliabilityByName),
  )

  const rows: PlanRow[] = sorted.map(opp => {
    const score  = scoreOf(opp, reliabilityByName)
    const sizing = sizeOpportunity(opp, equity, config)

    if (!sizing.approved) {
      const status: PlanRow["status"] =
        sizing.reason?.includes("entry_hint or stop_hint") ? "missing_data" :
        sizing.reason?.includes("size = 0") ? "size_zero" : "size_zero"
      return { opportunity: opp, sizing, score, status, block_reason: sizing.reason }
    }

    // Cap 1: max open positions
    if (projectedOpen >= config.max_open_positions) {
      return { opportunity: opp, sizing, score, status: "risk_blocked",
               block_reason: `max_open_positions=${config.max_open_positions} reached` }
    }
    // Cap 2: don't double up on existing positions
    if (heldSymbols.has(opp.instrument.toUpperCase())) {
      return { opportunity: opp, sizing, score, status: "risk_blocked",
               block_reason: `already holding ${opp.instrument}` }
    }
    // Cap 3: asset class % of equity
    const newClassExposure = (assetClassExposure[opp.asset_class] ?? 0) + sizing.dollar_amount
    const classCap         = config.asset_class_caps[opp.asset_class] ?? 0
    if (newClassExposure > equity * classCap) {
      return { opportunity: opp, sizing, score, status: "risk_blocked",
               block_reason: `${opp.asset_class} cap ${(classCap * 100).toFixed(0)}% would be exceeded` }
    }

    // Accept — commit to running totals
    approvedCount++
    totalRisk    += sizing.dollar_risk
    projectedOpen++
    assetClassExposure[opp.asset_class] = newClassExposure
    return { opportunity: opp, sizing, score, status: "approved" }
  })

  return {
    equity,
    rows,
    approved_count: approvedCount,
    total_dollar_at_risk: totalRisk,
  }
}
