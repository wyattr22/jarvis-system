// Defaults shape verification — DB-backed read/write paths are integration-tested
// in Phase 7 when we add a vitest test-DB harness.

import { describe, it, expect } from "vitest"
import { DEFAULT_RISK_CONFIG } from "./risk-config"

describe("DEFAULT_RISK_CONFIG", () => {
  it("has conservative defaults", () => {
    expect(DEFAULT_RISK_CONFIG.max_risk_per_trade_pct).toBeLessThanOrEqual(0.02)
    expect(DEFAULT_RISK_CONFIG.max_daily_loss_pct).toBeLessThanOrEqual(0.05)
    expect(DEFAULT_RISK_CONFIG.kelly_fraction_cap).toBeLessThanOrEqual(0.50)
  })

  it("covers every asset class our adapter registry knows about", () => {
    const classes = Object.keys(DEFAULT_RISK_CONFIG.asset_class_caps)
    expect(classes).toContain("equity")
    expect(classes).toContain("crypto")
    expect(classes).toContain("futures")
    expect(classes).toContain("forex")
    expect(classes).toContain("options")
    expect(classes).toContain("prediction")
  })

  it("every asset class cap is in [0, 1]", () => {
    for (const [cls, cap] of Object.entries(DEFAULT_RISK_CONFIG.asset_class_caps)) {
      expect(cap, `${cls} cap`).toBeGreaterThanOrEqual(0)
      expect(cap, `${cls} cap`).toBeLessThanOrEqual(1)
    }
  })

  it("max_open_positions is a positive integer", () => {
    expect(Number.isInteger(DEFAULT_RISK_CONFIG.max_open_positions)).toBe(true)
    expect(DEFAULT_RISK_CONFIG.max_open_positions).toBeGreaterThan(0)
  })
})
