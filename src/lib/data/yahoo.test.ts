import { describe, it, expect } from "vitest"
import { mapChartMetaToQuote } from "./yahoo"

describe("mapChartMetaToQuote", () => {
  it("maps price, changePct and asOf from chart meta", () => {
    const q = mapChartMetaToQuote(
      "ES=F",
      { regularMarketPrice: 7549, chartPreviousClose: 7528.25, regularMarketTime: 1783312385 },
      "yahoo.futures",
    )
    expect(q).not.toBeNull()
    expect(q!.price).toBe(7549)
    expect(q!.changePct).toBeCloseTo(((7549 - 7528.25) / 7528.25) * 100, 6)
    expect(q!.meta.source).toBe("yahoo.futures")
    expect(q!.meta.realtime).toBe(false)
    expect(q!.meta.asOf).toBe(new Date(1783312385 * 1000).toISOString())
  })

  it("returns null for a dead symbol payload (price missing)", () => {
    // Exactly what Yahoo returns for the dead ^DXY symbol
    const q = mapChartMetaToQuote("^DXY", { regularMarketTime: 1561759658 }, "yahoo.index")
    expect(q).toBeNull()
  })

  it("returns null changePct when prev close is missing", () => {
    const q = mapChartMetaToQuote("^VIX", { regularMarketPrice: 15.81 }, "yahoo.index")
    expect(q!.changePct).toBeNull()
  })
})
