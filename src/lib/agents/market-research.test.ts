import { describe, it, expect } from "vitest"
import { buildResearchContext } from "./market-research"

describe("buildResearchContext", () => {
  it("assembles all sections with caps", () => {
    const ctx = buildResearchContext({
      headlines: Array.from({ length: 40 }, (_, i) => ({ source: "MacroVoices", title: `Episode ${i}` })),
      intermarket: "DXY 100.9 | 10Y yield 4.49%",
      optionsPulse: "SPY OPTIONS: max_pain=$745",
      topUniverse: [{ symbol: "IONS", reason: "high volatility", change_pct: -23.89 }],
    })
    expect(ctx).toContain("REPUTABLE SOURCES")
    expect((ctx.match(/\[MacroVoices\]/g) ?? []).length).toBe(30) // capped
    expect(ctx).toContain("INTERMARKET: DXY 100.9")
    expect(ctx).toContain("max_pain=$745")
    expect(ctx).toContain("IONS: -23.89% (high volatility)")
  })

  it("omits empty sections gracefully", () => {
    const ctx = buildResearchContext({ headlines: [], intermarket: "unavailable", optionsPulse: null, topUniverse: [] })
    expect(ctx).not.toContain("REPUTABLE SOURCES")
    expect(ctx).not.toContain("OPTIONS POSITIONING")
    expect(ctx).toContain("INTERMARKET: unavailable")
  })
})
