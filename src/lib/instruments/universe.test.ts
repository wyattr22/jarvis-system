import { describe, it, expect } from "vitest"
import { rankSymbolMatches, catalogEntries, type UniverseEntry } from "./universe"

const EQUITIES: [string, string][] = [
  ["AAPL", "Apple Inc. Common Stock"],
  ["AAPB", "GraniteShares 2x Long AAPL"],
  ["MSFT", "Microsoft Corporation"],
  ["ESTA", "Establishment Labs Holdings"],
]

describe("rankSymbolMatches", () => {
  it("ranks exact symbol above prefix above name substring", () => {
    const out = rankSymbolMatches("AAPL", EQUITIES, [])
    expect(out[0].symbol).toBe("AAPL") // exact
    expect(out[1].symbol).toBe("AAPB") // name contains "AAPL"
    const prefixes = rankSymbolMatches("AAP", EQUITIES, [])
    expect(prefixes.map(e => e.symbol).slice(0, 2)).toEqual(["AAPL", "AAPB"])
  })

  it("matches names by substring", () => {
    const out = rankSymbolMatches("MICROSOFT", EQUITIES, [])
    expect(out.map(e => e.symbol)).toContain("MSFT")
  })

  it("includes catalog futures/forex/indexes", () => {
    const out = rankSymbolMatches("ES", EQUITIES, catalogEntries())
    expect(out.some(e => e.symbol === "ES=F" && e.assetClass === "futures")).toBe(true)
    expect(out.some(e => e.symbol === "ESTA")).toBe(true)
  })

  it("finds forex pairs and indexes", () => {
    const fx = rankSymbolMatches("EUR/USD", [], catalogEntries())
    expect(fx[0]).toMatchObject({ symbol: "EUR/USD", assetClass: "forex" })
    const vix = rankSymbolMatches("^VIX", [], catalogEntries())
    expect(vix[0]).toMatchObject({ assetClass: "index" })
  })

  it("respects the limit and empty query", () => {
    expect(rankSymbolMatches("", EQUITIES, catalogEntries())).toEqual([])
    const big: [string, string][] = Array.from({ length: 100 }, (_, i) => [`AB${i}`, `Company AB${i}`])
    expect(rankSymbolMatches("AB", big, []).length).toBeLessThanOrEqual(20)
  })
})
