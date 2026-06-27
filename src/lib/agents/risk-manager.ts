import { db } from "@/lib/db/client"
import { route } from "@/lib/llm/router"
import { LIMITS } from "@/lib/guardrails/limits"
import { getCorrelationMatrix } from "@/lib/validation/correlation"
import { parseAndValidate, RiskOutputSchema, type RiskOutput, type ProposalOutput } from "./schema"
import type { AllocatorPlan } from "@/lib/allocator/scorer"
import type { RiskConfig } from "@/lib/allocator/risk-config"

export async function runRiskManager(
  proposal: ProposalOutput,
  accountEquity: number
): Promise<RiskOutput> {
  // Hard rule checks first
  const hardRuleViolations: string[] = []

  // Check proposed position size if applicable
  const change = proposal.proposed_change
  if (change.parameter === "position_size_pct" && typeof change.new_value === "number") {
    if (change.new_value > LIMITS.MAX_POSITION_SIZE_PCT) {
      hardRuleViolations.push(
        `Position size ${(change.new_value * 100).toFixed(1)}% exceeds hard cap ${(LIMITS.MAX_POSITION_SIZE_PCT * 100).toFixed(0)}%`
      )
    }
  }

  if (hardRuleViolations.length > 0) {
    return {
      verdict: "veto",
      reason: `Hard rule violation: ${hardRuleViolations.join("; ")}`,
      risk_factors: hardRuleViolations,
      correlation_concern: false,
      regime_concentration: false,
    }
  }

  // Get correlation data for soft judgment context
  const correlations = await getCorrelationMatrix()
  const highCorrelations = correlations.filter(c =>
    (c.strategyA === proposal.strategy_id || c.strategyB === proposal.strategy_id) &&
    Math.abs(c.correlation) > 0.6
  )

  // Get active strategy count
  const activeStrategies = await db.execute(
    "SELECT COUNT(*) as n FROM strategies WHERE enabled = 1"
  )

  const agentRow = await db.execute(
    "SELECT system_prompt FROM agents WHERE id = 'risk-manager-groq'"
  )
  const systemPrompt = (agentRow.rows[0]?.system_prompt as string) ?? ""

  const contextText = `
Account equity: $${accountEquity.toLocaleString()}
Active strategies: ${activeStrategies.rows[0]?.n ?? 1}
Hard caps: max daily loss ${(LIMITS.MAX_DAILY_LOSS_PCT * 100).toFixed(0)}%, max position ${(LIMITS.MAX_POSITION_SIZE_PCT * 100).toFixed(0)}%
High-correlation strategies: ${highCorrelations.length > 0 ? highCorrelations.map(c => `${c.strategyA}↔${c.strategyB} (${c.correlation.toFixed(2)})`).join(", ") : "none"}

Proposal: ${JSON.stringify(proposal, null, 2)}

Output JSON: { "verdict": "approve"|"veto", "reason": string, "risk_factors": string[], "correlation_concern": boolean, "regime_concentration": boolean }`

  const MAX_RETRIES = 2
  let lastError = ""

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const raw = await route({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextText },
        ],
        preferredModel: "groq-llama-70b",
        cacheable: false,
      })
      return parseAndValidate(RiskOutputSchema, raw)
    } catch (e) {
      lastError = String(e)
    }
  }

  // Default to veto on parse failure
  return {
    verdict: "veto",
    reason: `Risk manager output invalid after ${MAX_RETRIES} attempts: ${lastError}`,
    risk_factors: ["parse_failure"],
    correlation_concern: false,
    regime_concentration: false,
  }
}

// ── Allocator plan veto ───────────────────────────────────────
//
// Sibling function to runRiskManager but operates on an AllocatorPlan from
// the Phase 4 allocator. Returns per-opportunity verdicts + a plan-level
// summary. Soft-vetoes (warnings) for things the scorer already filtered,
// hard-vetoes for global plan violations (e.g. daily loss cap).
//
// Pure function. Doesn't call an LLM. Fast — runs synchronously inside the
// allocator execute path before any orders are placed.

export type PlanVetoResult = {
  verdict: "approve" | "veto" | "approve_with_warnings"
  reason: string
  per_opportunity: Array<{
    opportunity_id: string
    allow: boolean
    reason?: string
  }>
  warnings: string[]
}

export function vetoAllocatorPlan(
  plan: AllocatorPlan,
  config: RiskConfig,
  todayPnl: number,  // current realised day-to-date P&L (negative = loss)
): PlanVetoResult {
  const warnings: string[] = []
  const perOpp: PlanVetoResult["per_opportunity"] = []
  let hardVeto = false
  let hardReason = ""

  // Hard cap: if today's loss already at or beyond max_daily_loss_pct, veto all.
  const dailyLossLimit = -1 * plan.equity * config.max_daily_loss_pct
  if (todayPnl <= dailyLossLimit) {
    hardVeto = true
    hardReason = `daily loss ${todayPnl.toFixed(0)} hit cap of ${dailyLossLimit.toFixed(0)} (${(config.max_daily_loss_pct * 100).toFixed(1)}%)`
  }

  // Hard cap: plan total $ at risk would push daily loss over the cap.
  // Assume worst case = all approved rows hit stop.
  const projectedWorstCase = todayPnl - plan.total_dollar_at_risk
  if (projectedWorstCase < dailyLossLimit && !hardVeto) {
    hardVeto = true
    hardReason = `plan worst-case (all stops hit) would exceed daily loss cap: projected ${projectedWorstCase.toFixed(0)} vs cap ${dailyLossLimit.toFixed(0)}`
  }

  // Per-opportunity: check that each individual row's risk_pct_of_equity
  // respects the hardcoded LIMITS as well as the configured cap.
  for (const row of plan.rows) {
    if (row.status !== "approved") {
      perOpp.push({ opportunity_id: row.opportunity.id, allow: false, reason: row.block_reason ?? row.status })
      continue
    }
    if (hardVeto) {
      perOpp.push({ opportunity_id: row.opportunity.id, allow: false, reason: hardReason })
      continue
    }
    if (row.sizing.risk_pct_of_equity > LIMITS.MAX_RISK_PER_TRADE_PCT) {
      perOpp.push({
        opportunity_id: row.opportunity.id,
        allow: false,
        reason: `risk ${(row.sizing.risk_pct_of_equity * 100).toFixed(2)}% exceeds hard cap ${(LIMITS.MAX_RISK_PER_TRADE_PCT * 100).toFixed(0)}%`,
      })
      continue
    }
    perOpp.push({ opportunity_id: row.opportunity.id, allow: true })
  }

  if (hardVeto) {
    return {
      verdict: "veto",
      reason: hardReason,
      per_opportunity: perOpp,
      warnings,
    }
  }

  // Soft warnings (don't block, but surface for the council/UI)
  if (plan.approved_count > config.max_open_positions / 2) {
    warnings.push(`plan would open ${plan.approved_count} positions (more than half of max_open_positions=${config.max_open_positions})`)
  }
  if (plan.total_dollar_at_risk > plan.equity * config.max_daily_loss_pct * 0.75) {
    warnings.push(`plan $ at risk ${plan.total_dollar_at_risk.toFixed(0)} is >75% of daily-loss cap`)
  }

  return {
    verdict: warnings.length > 0 ? "approve_with_warnings" : "approve",
    reason: warnings.length > 0 ? "approved with risk warnings (see warnings list)" : "all checks passed",
    per_opportunity: perOpp,
    warnings,
  }
}
