import { z } from "zod"
import { StrategyDefinitionSchema } from "@/lib/strategy-engine/schema"

// Existing 4 change types (parameter/filter/rule tweaks to an ALREADY-LIVE
// strategy) — unchanged shape, so every proposal already in the DB stays
// valid against this schema.
const TweakChangeSchema = z.object({
  type: z.enum(["add_filter", "modify_parameter", "remove_rule", "add_rule"]),
  description: z.string(),
  parameter: z.string().optional(),
  old_value: z.unknown().optional(),
  new_value: z.unknown().optional(),
  filter_expression: z.string().optional(),
})

// New (Phase 20): a proposal that authors an entirely new strategy rather
// than tweaking an existing one. Carries a full StrategyDefinition so the
// orchestrator can backtest it immediately — there's no live trade history
// for a brand-new candidate, which is exactly why this type exists as its
// own branch rather than reusing modify_parameter's shape.
const NewStrategyChangeSchema = z.object({
  type: z.literal("new_strategy"),
  description: z.string(),
  strategy_definition: StrategyDefinitionSchema,
})

export const ProposalOutputSchema = z.object({
  strategy_id: z.string(),
  hypothesis: z.string().min(50),
  // Plain union, not discriminatedUnion: TweakChangeSchema's discriminant is
  // itself a 4-value enum (one "branch" covering 4 literals), which
  // discriminatedUnion doesn't support directly. The two schemas' `type`
  // value sets are disjoint, so zod's ordinary matching disambiguates fine.
  proposed_change: z.union([TweakChangeSchema, NewStrategyChangeSchema]),
  // Optional (was required): a brand-new strategy has no Observer-derived
  // statistical evidence to report yet — it's validated by backtesting
  // (see orchestrator.ts's new_strategy branch), not by a feature/threshold
  // pattern that presupposes trade history that can't exist yet.
  evidence: z.object({
    feature_name: z.string(),
    threshold: z.number(),
    direction: z.enum(["above", "below"]),
    lift: z.number(),
    base_win_rate: z.number(),
    filtered_win_rate: z.number(),
    sample_size: z.number().int().positive(),
    p_value: z.number(),
  }).optional(),
  expected_improvement: z.object({
    win_rate_delta: z.number(),
    r_delta: z.number(),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  test_plan: z.string().min(20),
  risks: z.array(z.string()),
})

export const CriticOutputSchema = z.object({
  scores: z.object({
    novelty: z.number().min(0).max(1),
    evidence_quality: z.number().min(0).max(1),
    overfit_risk: z.number().min(0).max(1),
    alignment: z.number().min(0).max(1),
  }),
  overall_score: z.number().min(0).max(1),
  critique: z.string().min(20),
  concerns: z.array(z.string()),
  verdict: z.enum(["approve", "approve_with_caution", "reject"]),
})

export const RiskOutputSchema = z.object({
  verdict: z.enum(["approve", "veto"]),
  reason: z.string().min(10),
  risk_factors: z.array(z.string()),
  correlation_concern: z.boolean(),
  regime_concentration: z.boolean(),
})

export const MetaDecisionOutputSchema = z.object({
  decisions: z.array(z.object({
    decision_type: z.enum(["update_prompt", "adjust_weight", "spawn_agent", "kill_agent"]),
    target_agent_id: z.string(),
    rationale: z.string().min(30),
    proposed_change: z.record(z.string(), z.unknown()),
    evidence: z.object({
      n_outcomes: z.number().int(),
      accuracy: z.number(),
      type_1_errors: z.number().int(),
      type_2_errors: z.number().int(),
    }),
  })),
})

export type ProposalOutput = z.infer<typeof ProposalOutputSchema>
export type CriticOutput = z.infer<typeof CriticOutputSchema>
export type RiskOutput = z.infer<typeof RiskOutputSchema>
export type MetaDecisionOutput = z.infer<typeof MetaDecisionOutputSchema>

export function parseAndValidate<T>(schema: z.ZodType<T>, raw: string): T {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("No JSON found in LLM output")
  const parsed = JSON.parse(jsonMatch[0])
  return schema.parse(parsed)
}
