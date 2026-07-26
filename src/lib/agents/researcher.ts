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

// Strategy-Author mode (Phase 20): when brainstorming with zero Observer
// patterns, and explicitly enabled, ask for an entirely new strategy
// (proposed_change.type: "new_strategy") instead of a tweak to the existing
// one. Default OFF -- running this every council cycle unattended would
// mean ~52 untriaged candidates/year competing for review attention before
// the user has evaluated the first few by hand, the same reasoning
// auto_execute itself defaults off for.
const STRATEGY_AUTHOR_ENABLED = process.env.STRATEGY_AUTHOR_ENABLED === "true"

const STRATEGY_DEFINITION_SPEC = `A StrategyDefinition is JSON with this shape:
{
  "id": string (a short kebab-case slug, e.g. "rsi-mean-reversion-v1"),
  "version": 1,
  "universe": "active_scan_universe" | string[] (explicit symbol/pair list),
  "timeframe": "15Min",
  "entry": {
    "biasSource": "daily_bias" | "fixed_long" | "fixed_short" | "both",
    "minEntryPrice": number,
    "requireSpyAlignment": boolean,
    "condition": Condition,       // the main entry signal
    "filters": Condition[]        // additional hard AND-gates
  },
  "exit": {
    "stop": { "mode": "pct", "value": number }
          | { "mode": "atr_multiple", "value": number, "atrPeriod"?: number }
          | { "mode": "structure" },
    "target": { "mode": "pct", "value": number }
             | { "mode": "r_multiple", "value": number },
    "minRR": number,
    "maxStopRiskPct"?: number
  }
}

A Condition is one of:
  { "op": "gt"|"gte"|"lt"|"lte", "indicator": IndicatorRef, "value": number }
  { "op": "true_when", "indicator": IndicatorRef }   // for boolean detectors
  { "op": "and"|"or", "conditions": Condition[] }
  { "op": "not", "condition": Condition }
  { "op": "count_at_least", "min": number, "conditions": Condition[] }
  { "op": "trend_favors_bias", "emaFastPeriod": number, "emaSlowPeriod": number }

An IndicatorRef is one of:
  { "kind": "price" }
  { "kind": "rsi", "period"?: number }
  { "kind": "ema", "period": number }
  { "kind": "volume_ratio", "period"?: number }        // bar volume / volume MA
  { "kind": "atr_pct", "period"?: number }             // ATR / price
  { "kind": "body_size_ratio", "period"?: number }     // |candle body| / avg body
  { "kind": "ifvg" } | { "kind": "bos" } | { "kind": "ote" }              // reversal detectors (need biasSource daily_bias/both)
  { "kind": "fvg" } | { "kind": "equilibrium" } | { "kind": "order_block" } | { "kind": "breaker" }  // continuation detectors
  { "kind": "liquidity_raid" } | { "kind": "prev_candle_confirms" } | { "kind": "spy_alignment" }

Only use "dol_or_pct" or the equilibrium/liquidity_raid indicators when biasSource is "daily_bias" or "both" -- they depend on the daily-bias engine and are meaningless with a fixed direction. Prefer "pct"/"r_multiple"/"atr_multiple"/"structure" and the RSI/EMA/volume/ATR indicators for a genuinely new idea -- don't just re-derive smc-ict-v4's own confluence rules.`

export async function runResearcher(strategyId: string): Promise<ProposalOutput | null> {
  const [patterns, strategy, history, dynKnowledge] = await Promise.all([
    getTopPatterns(),
    getStrategyContext(strategyId),
    getRecentProposalHistory(),
    getDynamicKnowledge(),
  ])

  // Brainstorm mode: if no Observer patterns, generate a novel strategy hypothesis from the knowledge base
  const brainstormMode = !patterns || patterns.trim().length === 0
  const strategyAuthorMode = brainstormMode && STRATEGY_AUTHOR_ENABLED

  const agentRow = await db.execute(
    "SELECT system_prompt FROM agents WHERE id = 'researcher-groq'"
  )
  const systemPrompt = (agentRow.rows[0]?.system_prompt as string) ?? ""

  if (strategyAuthorMode) {
    return runStrategyAuthor(systemPrompt, strategy, history, dynKnowledge)
  }

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

  return storeProposal(strategyId, output)
}

async function storeProposal(loggedStrategyId: string, output: ProposalOutput): Promise<ProposalOutput> {
  const proposalId = `prop-${Date.now()}`
  await db.execute({
    sql: `INSERT INTO proposals (id, strategy_id, hypothesis, proposed_change_json, evidence_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    args: [
      proposalId,
      output.strategy_id,
      output.hypothesis,
      JSON.stringify(output.proposed_change),
      // evidence is optional (Phase 20: new_strategy proposals have none
      // yet, validated by backtest instead) -- JSON.stringify(undefined)
      // would produce the literal string "undefined", not valid JSON.
      JSON.stringify(output.evidence ?? null),
      Date.now(),
    ],
  })

  await auditLog("researcher", "proposal_created", { proposalId, strategyId: loggedStrategyId })
  return output
}

async function runStrategyAuthor(
  systemPrompt: string,
  strategyContext: string,
  history: string,
  dynKnowledge: string,
): Promise<ProposalOutput | null> {
  const userPrompt = `You are a quantitative trading researcher with deep expertise in the following strategy and trading methods:

${CURRENT_STRATEGY_KNOWLEDGE}

ADDITIONAL TRADING FRAMEWORKS YOU KNOW:
${TRADING_LIBRARY_COMPACT}

The currently deployed strategy for reference (do NOT just re-describe this one):
${strategyContext}

The Observer has no statistical patterns yet (insufficient trade data), and strategy-authoring mode is enabled. Instead of tweaking the existing strategy, author an ENTIRELY NEW, TESTABLE strategy as a StrategyDefinition (a declarative rule format interpreted deterministically, NOT executable code). Draw on the trading frameworks above for a genuinely different idea — e.g. mean reversion for ranging markets, a volatility-breakout system, a simple RSI/EMA trend-following approach — rather than re-deriving smc-ict-v4's own SMC/ICT confluence rules.

${STRATEGY_DEFINITION_SPEC}

Recent proposal history (learn from rejections):
${history}
${dynKnowledge ? `\n${dynKnowledge}` : ""}

Draft a single high-quality proposal as valid JSON matching this schema:
{
  "strategy_id": string (same slug as strategy_definition.id below),
  "hypothesis": string (>50 chars, grounded in market microstructure — why should this edge exist?),
  "proposed_change": { "type": "new_strategy", "description": string, "strategy_definition": StrategyDefinition },
  "expected_improvement": { "win_rate_delta": number, "r_delta": number, "confidence": "low"|"medium"|"high" },
  "test_plan": string (>20 chars — how would you validate this before trusting it with capital?),
  "risks": string[]
}

Do NOT include an "evidence" field — there's no trade history for a brand-new strategy yet; it will be validated by backtesting instead.

Output ONLY valid JSON. No markdown, no explanation.`

  let output: ProposalOutput | null = null
  let lastError = ""

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const raw = await route({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
          ...(attempt > 0 ? [{ role: "assistant" as const, content: "I'll output only JSON." }, { role: "user" as const, content: `Previous attempt failed: ${lastError}. Output valid JSON only, matching the StrategyDefinition schema exactly.` }] : []),
        ],
        // Strategy authorship gets the premium tier (Phase 19) -- this is
        // the reasoning decision #3 explicitly called out as worth the
        // expensive-model cost, unlike routine parameter-tweak proposals
        // which stay on the cheap tier that's already worked fine for them.
        preferredCostTier: "premium",
        cacheable: false,
      })
      const parsed = parseAndValidate(ProposalOutputSchema, raw)
      // Keep strategy_id and the embedded definition's id in sync
      // regardless of whether the LLM's output already agreed with itself.
      if (parsed.proposed_change.type === "new_strategy") {
        parsed.strategy_id = parsed.proposed_change.strategy_definition.id
      }
      output = parsed
      break
    } catch (e) {
      lastError = String(e)
    }
  }

  if (!output) {
    await auditLog("researcher", "strategy_author_failed", { error: lastError })
    return null
  }

  return storeProposal(output.strategy_id, output)
}
