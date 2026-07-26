// StrategyDefinition — the declarative rule format a strategy (human- or
// LLM-authored) is expressed in (Phase 16). Interpreted by ./interpreter.ts
// against real bar data; no code execution, no sandbox, fully deterministic.
//
// Design: entry logic is composable boolean conditions over a fixed
// indicator vocabulary (this is the part an author actually varies — which
// indicators, which thresholds, which confluence combinations). Stop/target
// are a small fixed set of *computation modes*, not conditions — "how do I
// derive a stop price" isn't a yes/no question the way "is RSI above 40" is.

import { z } from "zod"

// ── Indicator vocabulary ──────────────────────────────────────────────────
// Every indicator resolves to a single number or boolean for the *current*
// bar, computed via the shared primitives in ./indicators.ts. Ratio-shaped
// indicators (volume_ratio, atr_pct, body_size_ratio) exist specifically so
// threshold conditions stay simple comparisons against a plain number,
// mirroring how the legacy StrategyParams fields (volumeMultiplier,
// atrMinPct) already worked.
export const IndicatorRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("price") }),
  z.object({ kind: z.literal("rsi"), period: z.number().int().positive().default(14) }),
  z.object({ kind: z.literal("ema"), period: z.number().int().positive() }),
  z.object({ kind: z.literal("volume_ratio"), period: z.number().int().positive().default(20) }),
  z.object({ kind: z.literal("atr_pct"), period: z.number().int().positive().default(14) }),
  z.object({ kind: z.literal("body_size_ratio"), period: z.number().int().positive().default(20) }),
  // Boolean SMC/ICT detectors — "true_when" wraps these into a Condition.
  z.object({ kind: z.literal("ifvg") }),
  z.object({ kind: z.literal("bos") }),
  z.object({ kind: z.literal("ote") }),
  z.object({ kind: z.literal("fvg") }),
  z.object({ kind: z.literal("equilibrium") }),
  z.object({ kind: z.literal("order_block") }),
  z.object({ kind: z.literal("breaker") }),
  z.object({ kind: z.literal("liquidity_raid") }),
  z.object({ kind: z.literal("prev_candle_confirms") }),
  z.object({ kind: z.literal("spy_alignment") }),
])
export type IndicatorRef = z.infer<typeof IndicatorRefSchema>

// ── Conditions ─────────────────────────────────────────────────────────────
const NumericComparisonSchema = z.object({
  op: z.enum(["gt", "gte", "lt", "lte"]),
  indicator: IndicatorRefSchema,
  value: z.number(),
})
const BooleanCheckSchema = z.object({
  op: z.literal("true_when"),
  indicator: IndicatorRefSchema,
})
// The one composite, non-decomposed gate: "price + fast/slow EMA are
// ordered in the direction that favors whichever bias this bar computed."
// Modeled as its own condition (rather than forcing bias-relative gt/lt
// semantics into the generic comparison schema) because "trend alignment"
// is a genuinely reusable, well-defined concept on its own.
const TrendFavorsBiasSchema = z.object({
  op: z.literal("trend_favors_bias"),
  emaFastPeriod: z.number().int().positive(),
  emaSlowPeriod: z.number().int().positive(),
})

export type Condition =
  | z.infer<typeof NumericComparisonSchema>
  | z.infer<typeof BooleanCheckSchema>
  | z.infer<typeof TrendFavorsBiasSchema>
  | { op: "and" | "or"; conditions: Condition[] }
  | { op: "not"; condition: Condition }
  | { op: "count_at_least"; min: number; conditions: Condition[] }

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("op", [
    NumericComparisonSchema,
    BooleanCheckSchema,
    TrendFavorsBiasSchema,
    z.object({ op: z.enum(["and", "or"]), conditions: z.array(ConditionSchema).min(1) }),
    z.object({ op: z.literal("not"), condition: ConditionSchema }),
    z.object({
      op: z.literal("count_at_least"),
      min: z.number().int().positive(),
      conditions: z.array(ConditionSchema).min(1),
    }),
  ])
)

// ── Stop / target computation modes ────────────────────────────────────────
export const StopModeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("pct"), value: z.number().positive() }),
  z.object({ mode: z.literal("atr_multiple"), value: z.number().positive(), atrPeriod: z.number().int().positive().default(14) }),
  // Nearest opposite order block (or a 6-bar swing fallback) — legacy's mode.
  z.object({ mode: z.literal("structure") }),
])

export const TargetModeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("pct"), value: z.number().positive() }),
  z.object({ mode: z.literal("r_multiple"), value: z.number().positive() }),
  // Legacy-specific: use the daily-bias draw-on-liquidity level when it's
  // far enough away (> value*0.5 from entry), else fall back to a flat pct
  // target. A general-purpose new strategy would normally reach for "pct"
  // or "r_multiple" instead — this mode exists so smc-ict-v4 can be
  // expressed as data without changing its live behavior at all.
  z.object({ mode: z.literal("dol_or_pct"), value: z.number().positive() }),
])

// ── Top-level definition ───────────────────────────────────────────────────
export const StrategyDefinitionSchema = z.object({
  id: z.string(),
  version: z.literal(1),
  /** Which symbols this strategy scans. An explicit list lets a strategy
   *  target e.g. forex pairs instead of the equity scan universe. */
  universe: z.union([z.literal("active_scan_universe"), z.array(z.string())]),
  timeframe: z.string().default("15Min"),

  entry: z.object({
    /** v1: strategies are directional via the SMC daily-bias engine. A
     *  simpler non-SMC strategy can skip bias-dependent indicators/filters
     *  entirely and just use fixed_long/fixed_short/both. */
    biasSource: z.enum(["daily_bias", "fixed_long", "fixed_short", "both"]).default("daily_bias"),
    minEntryPrice: z.number().nonnegative().default(2.0),
    requireSpyAlignment: z.boolean().default(false),
    /** Main confluence/signal condition — must be true to enter. */
    condition: ConditionSchema,
    /** Additional hard AND-gates (RSI band, ATR floor, volume floor, body
     *  size cap, candle confirmation, liquidity raid, trend alignment...). */
    filters: z.array(ConditionSchema).default([]),
  }),

  exit: z.object({
    stop: StopModeSchema,
    target: TargetModeSchema,
    minRR: z.number().positive().default(2.0),
    maxStopRiskPct: z.number().positive().optional(),
  }),
})
export type StrategyDefinition = z.infer<typeof StrategyDefinitionSchema>
