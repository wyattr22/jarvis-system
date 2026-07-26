// smc-ict-v4 expressed as a StrategyDefinition (Phase 16) — reproduces
// bot-strategy.ts's DEFAULT_PARAMS/checkBotSignal exactly, condition for
// condition. This is both (a) the migration target once Phase 17 wires
// strategies.definition_json in, and (b) the parity proof: interpreter.ts
// run against this definition must match checkBotSignal(..., DEFAULT_PARAMS)
// bar-for-bar (see interpreter.test.ts).
import type { StrategyDefinition } from "./schema"

export const SMC_ICT_V4_DEFINITION: StrategyDefinition = {
  id: "smc-ict-v4",
  version: 1,
  universe: "active_scan_universe",
  timeframe: "15Min",
  entry: {
    biasSource: "daily_bias",
    minEntryPrice: 2.0,
    requireSpyAlignment: true,
    // Reversal confluence: 2 of {IFVG, BOS, OTE}
    condition: {
      op: "count_at_least",
      min: 2,
      conditions: [
        { op: "true_when", indicator: { kind: "ifvg" } },
        { op: "true_when", indicator: { kind: "bos" } },
        { op: "true_when", indicator: { kind: "ote" } },
      ],
    },
    filters: [
      { op: "gte", indicator: { kind: "rsi", period: 14 }, value: 40 },
      { op: "lte", indicator: { kind: "rsi", period: 14 }, value: 80 },
      { op: "gte", indicator: { kind: "volume_ratio", period: 20 }, value: 1.0 },
      { op: "gte", indicator: { kind: "atr_pct", period: 14 }, value: 0.004 },
      { op: "lte", indicator: { kind: "body_size_ratio", period: 20 }, value: 4.0 },
      { op: "true_when", indicator: { kind: "prev_candle_confirms" } },
      { op: "true_when", indicator: { kind: "liquidity_raid" } },
      // Continuation confluence: 1 of {FVG, EQ, OB, Breaker}
      {
        op: "count_at_least",
        min: 1,
        conditions: [
          { op: "true_when", indicator: { kind: "fvg" } },
          { op: "true_when", indicator: { kind: "equilibrium" } },
          { op: "true_when", indicator: { kind: "order_block" } },
          { op: "true_when", indicator: { kind: "breaker" } },
        ],
      },
      { op: "trend_favors_bias", emaFastPeriod: 9, emaSlowPeriod: 21 },
    ],
  },
  exit: {
    stop: { mode: "structure" },
    target: { mode: "dol_or_pct", value: 0.04 },
    minRR: 2.0,
    maxStopRiskPct: 0.03,
  },
}
