import { describe, it, expect } from "vitest"
import { computeDrawdowns } from "./drawdown-monitor"
import type { Position } from "@/lib/brokers/adapter"

function pos(symbol: string, qty: number, avg: number, unrealized: number): Position {
  return { symbol, qty, avg_entry_price: avg, unrealized_pl: unrealized, side: qty >= 0 ? "long" : "short" }
}

describe("computeDrawdowns", () => {
  it("ignores winning positions", () => {
    const alerts = computeDrawdowns([pos("WIN", 10, 100, +50)])
    expect(alerts).toHaveLength(0)
  })

  it("ignores barely-underwater positions (above warn threshold)", () => {
    // 10 × $100 = $1000 cost. -2% = -$20. warn = -3%.
    const alerts = computeDrawdowns([pos("MEH", 10, 100, -20)])
    expect(alerts).toHaveLength(0)
  })

  it("flags warn-level positions", () => {
    // -4% drawdown
    const alerts = computeDrawdowns([pos("WARN", 10, 100, -40)])
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe("warn")
    expect(alerts[0].drawdown_pct).toBeCloseTo(-0.04, 5)
  })

  it("flags danger-level positions", () => {
    // -10% drawdown
    const alerts = computeDrawdowns([pos("DANGER", 10, 100, -100)])
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe("danger")
  })

  it("sorts most-underwater first", () => {
    const alerts = computeDrawdowns([
      pos("A", 10, 100, -40),  // -4%
      pos("B", 10, 100, -100), // -10%
      pos("C", 10, 100, -50),  // -5%
    ])
    expect(alerts.map(a => a.symbol)).toEqual(["B", "C", "A"])
  })

  it("ignores zero-qty entries", () => {
    expect(computeDrawdowns([pos("ZERO", 0, 100, -50)])).toHaveLength(0)
  })

  it("respects custom thresholds", () => {
    // -2% drawdown — under default warn, but over custom -1%
    const alerts = computeDrawdowns(
      [pos("CUSTOM", 10, 100, -20)],
      { warn_threshold: -0.01, danger_threshold: -0.05 },
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe("warn")
  })
})
