import { describe, it, expect } from "vitest"
import { StrategyDefinitionSchema } from "./schema"
import { SMC_ICT_V4_DEFINITION } from "./legacy-definition"

describe("StrategyDefinitionSchema", () => {
  it("accepts the legacy smc-ict-v4 definition", () => {
    const result = StrategyDefinitionSchema.safeParse(SMC_ICT_V4_DEFINITION)
    expect(result.success).toBe(true)
  })

  it("rejects a definition missing required fields", () => {
    const result = StrategyDefinitionSchema.safeParse({ id: "broken", version: 1 })
    expect(result.success).toBe(false)
  })

  it("rejects an unknown condition op", () => {
    const bad = {
      ...SMC_ICT_V4_DEFINITION,
      entry: {
        ...SMC_ICT_V4_DEFINITION.entry,
        condition: { op: "made_up_op", indicator: { kind: "rsi" } },
      },
    }
    const result = StrategyDefinitionSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("rejects an unknown indicator kind", () => {
    const bad = {
      ...SMC_ICT_V4_DEFINITION,
      entry: {
        ...SMC_ICT_V4_DEFINITION.entry,
        condition: { op: "true_when", indicator: { kind: "made_up_indicator" } },
      },
    }
    const result = StrategyDefinitionSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("accepts a minimal simple strategy (no SMC detectors at all)", () => {
    const simple = {
      id: "simple-rsi-cross",
      version: 1,
      universe: ["AAPL", "MSFT"],
      timeframe: "15Min",
      entry: {
        biasSource: "fixed_long",
        minEntryPrice: 5,
        requireSpyAlignment: false,
        condition: { op: "lt", indicator: { kind: "rsi", period: 14 }, value: 30 },
        filters: [],
      },
      exit: {
        stop: { mode: "pct", value: 0.02 },
        target: { mode: "r_multiple", value: 2 },
        minRR: 1.5,
      },
    }
    const result = StrategyDefinitionSchema.safeParse(simple)
    expect(result.success).toBe(true)
  })
})
