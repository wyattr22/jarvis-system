// Position sizing — turns an Opportunity + Equity + RiskConfig into a
// dollar amount and share count.
//
// Two caps applied:
//   1. Risk-per-trade — dollar risk is at most `equity × max_risk_per_trade_pct`
//   2. Kelly fraction — bet at most `kelly_fraction_cap × kelly_optimal`
// Final size is the smaller of the two.
//
// Pure functions. No DB, no broker calls. Easy to unit test, easy to reason about.

import type { Opportunity } from "@/lib/opportunities/store"
import type { RiskConfig } from "./risk-config"

export type SizingResult = {
  opportunity_id: string
  approved: boolean
  reason?: string                // why rejected, if not approved
  size: number                   // shares/contracts
  dollar_amount: number          // size × entry_hint
  dollar_risk: number            // size × |entry - stop|
  kelly_fraction: number         // raw Kelly fraction (informational)
  risk_pct_of_equity: number     // dollar_risk / equity
}

const ZERO: SizingResult = {
  opportunity_id: "",
  approved: false,
  size: 0,
  dollar_amount: 0,
  dollar_risk: 0,
  kelly_fraction: 0,
  risk_pct_of_equity: 0,
}

// Kelly criterion for a single bet:
//   f* = (p × b - q) / b
// where p = win prob, q = 1-p, b = win amount / loss amount (= expected_r)
export function kellyFraction(winProb: number, expectedR: number): number {
  if (winProb <= 0 || winProb >= 1) return 0
  if (expectedR <= 0) return 0
  const q = 1 - winProb
  const f = (winProb * expectedR - q) / expectedR
  return Math.max(0, f)  // never bet a negative fraction
}

export function sizeOpportunity(
  opp: Opportunity,
  equity: number,
  config: RiskConfig,
): SizingResult {
  const base: SizingResult = { ...ZERO, opportunity_id: opp.id }

  // Required fields for sizing math
  if (!opp.entry_hint || !opp.stop_hint) {
    return { ...base, reason: "missing entry_hint or stop_hint" }
  }
  if (opp.entry_hint <= 0 || opp.stop_hint <= 0) {
    return { ...base, reason: "non-positive entry/stop" }
  }
  if (equity <= 0) {
    return { ...base, reason: "non-positive equity" }
  }

  const perShareRisk = Math.abs(opp.entry_hint - opp.stop_hint)
  if (perShareRisk <= 0) {
    return { ...base, reason: "zero-distance stop" }
  }

  // Cap 1: max dollar risk per trade
  const maxDollarRisk = equity * config.max_risk_per_trade_pct
  const riskBasedSize = Math.floor(maxDollarRisk / perShareRisk)

  // Cap 2: Kelly fraction (if we have win_prob + expected_r)
  let kellyBasedSize = riskBasedSize  // default to risk-cap if Kelly inputs missing
  let kelly = 0
  if (opp.win_prob !== undefined && opp.expected_r !== undefined) {
    kelly = kellyFraction(opp.win_prob, opp.expected_r)
    const kellyCappedFraction = kelly * config.kelly_fraction_cap
    const kellyDollarAmount = equity * kellyCappedFraction
    kellyBasedSize = Math.floor(kellyDollarAmount / opp.entry_hint)
  }

  const size = Math.max(0, Math.min(riskBasedSize, kellyBasedSize))
  if (size === 0) {
    return {
      ...base,
      kelly_fraction: kelly,
      reason: "computed size = 0 (caps too tight or negative edge)",
    }
  }

  const dollarAmount = size * opp.entry_hint
  const dollarRisk = size * perShareRisk

  return {
    opportunity_id: opp.id,
    approved: true,
    size,
    dollar_amount: dollarAmount,
    dollar_risk: dollarRisk,
    kelly_fraction: kelly,
    risk_pct_of_equity: dollarRisk / equity,
  }
}
