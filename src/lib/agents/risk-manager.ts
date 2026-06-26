import { db } from "@/lib/db/client"
import { route } from "@/lib/llm/router"
import { LIMITS } from "@/lib/guardrails/limits"
import { getCorrelationMatrix } from "@/lib/validation/correlation"
import { parseAndValidate, RiskOutputSchema, type RiskOutput, type ProposalOutput } from "./schema"

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
