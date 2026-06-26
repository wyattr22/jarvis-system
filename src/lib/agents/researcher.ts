import { db } from "@/lib/db/client"
import { route } from "@/lib/llm/router"
import { parseAndValidate, ProposalOutputSchema, type ProposalOutput } from "./schema"
import { auditLog } from "@/lib/guardrails/audit"
import { CURRENT_STRATEGY_KNOWLEDGE, TRADING_LIBRARY_COMPACT } from "@/lib/knowledge"
import { getDynamicKnowledge } from "@/lib/knowledge/dynamic"

const MAX_RETRIES = 3

async function getTopPatterns(limit = 5): Promise<string> {
  const result = await db.execute({
    sql: `SELECT pattern_json FROM patterns
          WHERE validated = 0
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [limit],
  })
  return result.rows.map(r => r.pattern_json).join("\n\n")
}

async function getStrategyContext(strategyId: string): Promise<string> {
  const result = await db.execute({
    sql: "SELECT name, description, rules_json FROM strategies WHERE id = ?",
    args: [strategyId],
  })
  if (result.rows.length === 0) return "Strategy not found"
  const s = result.rows[0]
  return `Strategy: ${s.name}\nDescription: ${s.description}\nRules: ${s.rules_json}`
}

async function getRecentProposalHistory(): Promise<string> {
  const result = await db.execute({
    sql: `SELECT hypothesis, status, reviewer_notes FROM proposals
          ORDER BY created_at DESC LIMIT 5`,
  })
  if (result.rows.length === 0) return "No prior proposals."
  return result.rows.map(r =>
    `[${r.status}] ${(r.hypothesis as string).slice(0, 100)}${r.reviewer_notes ? ` — Notes: ${r.reviewer_notes}` : ""}`
  ).join("\n")
}

export async function runResearcher(strategyId: string): Promise<ProposalOutput | null> {
  const [patterns, strategy, history, dynKnowledge] = await Promise.all([
    getTopPatterns(),
    getStrategyContext(strategyId),
    getRecentProposalHistory(),
    getDynamicKnowledge(),
  ])

  // Brainstorm mode: if no Observer patterns, generate a novel strategy hypothesis from the knowledge base
  const brainstormMode = !patterns || patterns.trim().length === 0

  const agentRow = await db.execute(
    "SELECT system_prompt FROM agents WHERE id = 'researcher-groq'"
  )
  const systemPrompt = (agentRow.rows[0]?.system_prompt as string) ?? ""

  const userPrompt = `You are a quantitative trading researcher with deep expertise in the following strategy and trading methods:

${CURRENT_STRATEGY_KNOWLEDGE}

ADDITIONAL TRADING FRAMEWORKS YOU KNOW:
${TRADING_LIBRARY_COMPACT}

You are analyzing the following deployed strategy instance:
${strategy}

${brainstormMode
  ? `The Observer has no statistical patterns yet (insufficient trade data). Use your knowledge of the strategy and trading library to BRAINSTORM a novel improvement hypothesis. Consider: VIX regime filters, Wyckoff context, GEX-based bias adjustment, Kelly criterion sizing, or integrating a complementary strategy (mean reversion for ranging markets). Think creatively but keep it testable.`
  : `The ML Observer has discovered these patterns in recent trade data:\n${patterns}`
}

Recent proposal history (learn from rejections):
${history}
${dynKnowledge ? `\n${dynKnowledge}` : ""}

Draft a single high-quality proposal as valid JSON matching this schema:
{
  "strategy_id": string,
  "hypothesis": string (>50 chars, grounded in market microstructure),
  "proposed_change": { "type": "add_filter"|"modify_parameter"|"remove_rule"|"add_rule", "description": string, "parameter"?: string, "old_value"?: any, "new_value"?: any, "filter_expression"?: string },
  "evidence": { "feature_name": string, "threshold": number, "direction": "above"|"below", "lift": number, "base_win_rate": number, "filtered_win_rate": number, "sample_size": number, "p_value": number },
  "expected_improvement": { "win_rate_delta": number, "r_delta": number, "confidence": "low"|"medium"|"high" },
  "test_plan": string (>20 chars),
  "risks": string[]
}

Output ONLY valid JSON. No markdown, no explanation.`

  let output: ProposalOutput | null = null
  let lastError = ""

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const raw = await route({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
          ...(attempt > 0 ? [{ role: "assistant" as const, content: "I'll output only JSON." }, { role: "user" as const, content: `Previous attempt failed: ${lastError}. Output valid JSON only.` }] : []),
        ],
        preferredModel: "groq-llama-70b",
        cacheable: false,
      })
      output = parseAndValidate(ProposalOutputSchema, raw)
      break
    } catch (e) {
      lastError = String(e)
    }
  }

  if (!output) {
    await auditLog("researcher", "proposal_failed", { strategyId, error: lastError })
    return null
  }

  // Store proposal in DB
  const proposalId = `prop-${Date.now()}`
  await db.execute({
    sql: `INSERT INTO proposals (id, strategy_id, hypothesis, proposed_change_json, evidence_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    args: [
      proposalId,
      output.strategy_id,
      output.hypothesis,
      JSON.stringify(output.proposed_change),
      JSON.stringify(output.evidence),
      Date.now(),
    ],
  })

  await auditLog("researcher", "proposal_created", { proposalId, strategyId })
  return output
}
