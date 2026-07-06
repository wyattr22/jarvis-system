import { describe, it, expect } from "vitest"
import { mapFinnhubEarnings } from "./finnhub"

describe("mapFinnhubEarnings", () => {
  it("maps Finnhub calendar rows to the legacy EarningsItem shape", () => {
    const out = mapFinnhubEarnings([
      { symbol: "AAPL", date: "2026-07-30", epsEstimate: 2.35, quarter: 3, year: 2026 },
      { symbol: "MSFT", date: "2026-07-29", epsEstimate: null, quarter: 4, year: 2026 },
    ])
    expect(out).toEqual([
      {
        symbol: "MSFT",
        name: "MSFT",
        reportDate: "2026-07-29",
        fiscalDateEnding: "Q4 2026",
        estimate: "",
        currency: "USD",
      },
      {
        symbol: "AAPL",
        name: "AAPL",
        reportDate: "2026-07-30",
        fiscalDateEnding: "Q3 2026",
        estimate: "2.35",
        currency: "USD",
      },
    ])
  })

  it("drops rows without symbol or date and sorts by date", () => {
    const out = mapFinnhubEarnings([
      { symbol: "", date: "2026-07-30", epsEstimate: 1, quarter: 1, year: 2026 },
      { symbol: "ZZZ", date: "", epsEstimate: 1, quarter: 1, year: 2026 },
      { symbol: "BBB", date: "2026-08-02", epsEstimate: 1, quarter: 1, year: 2026 },
      { symbol: "AAA", date: "2026-08-01", epsEstimate: 1, quarter: 1, year: 2026 },
    ])
    expect(out.map(e => e.symbol)).toEqual(["AAA", "BBB"])
  })
})
