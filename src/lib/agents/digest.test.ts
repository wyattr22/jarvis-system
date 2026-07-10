import { describe, it, expect } from "vitest"
import { buildDigestContext } from "./digest"

describe("buildDigestContext", () => {
  it("assembles a full day", () => {
    const ctx = buildDigestContext({
      actions: [{ actor: "Signal engine", line: "Scanned 50 universe symbols for setups — found 2 signals" }],
      signals: [{ instrument: "AMD", direction: "long", status: "pending" }],
      orders: [{ symbol: "AMD", decided_by: "auto", status: "submitted" }],
      equity: 100000,
      dayPnl: 250,
      researchNote: "## Regime\nRisk-on",
      opsStatus: "healthy",
    })
    expect(ctx).toContain("RESEARCH VIEW")
    expect(ctx).toContain("[Signal engine] Scanned 50")
    expect(ctx).toContain("AMD long (pending)")
    expect(ctx).toContain("AMD (auto, submitted)")
    expect(ctx).toContain("equity $100000, day P&L $250")
    expect(ctx).toContain("SYSTEM HEALTH: healthy")
  })

  it("is honest about a quiet day", () => {
    const ctx = buildDigestContext({
      actions: [], signals: [], orders: [], equity: null, dayPnl: null, researchNote: null, opsStatus: null,
    })
    expect(ctx).toContain("No new signals today.")
    expect(ctx).toContain("No orders placed.")
    expect(ctx).not.toContain("RESEARCH VIEW")
  })
})
