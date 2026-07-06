import { describe, it, expect } from "vitest"
import { FUTURES_CATALOG, proxyFor } from "./proxies"

describe("FUTURES_CATALOG", () => {
  it("every entry has a Yahoo continuous symbol, root and positive multiplier", () => {
    for (const f of FUTURES_CATALOG) {
      expect(f.future).toMatch(/=F$/)
      expect(f.root.length).toBeGreaterThanOrEqual(2)
      expect(f.multiplier).toBeGreaterThan(0)
      expect(f.label.length).toBeGreaterThan(0)
    }
  })

  it("proxies are plain US-equity tickers (Alpaca IEX quotable)", () => {
    for (const f of FUTURES_CATALOG) {
      if (f.proxy) expect(f.proxy).toMatch(/^[A-Z]{1,5}$/)
    }
  })

  it("has no duplicate futures or roots", () => {
    const futures = FUTURES_CATALOG.map(f => f.future)
    const roots = FUTURES_CATALOG.map(f => f.root)
    expect(new Set(futures).size).toBe(futures.length)
    expect(new Set(roots).size).toBe(roots.length)
  })

  it("proxyFor resolves known and unknown symbols", () => {
    expect(proxyFor("ES=F")).toBe("SPY")
    expect(proxyFor("XX=F")).toBeNull()
  })
})
