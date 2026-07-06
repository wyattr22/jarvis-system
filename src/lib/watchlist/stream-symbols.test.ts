import { describe, it, expect } from "vitest"
import { pickStreamSymbols, DEFAULT_STREAM_SYMBOLS } from "./stream-symbols"

describe("pickStreamSymbols", () => {
  it("returns defaults when the watchlist is empty", () => {
    expect(pickStreamSymbols([])).toEqual(DEFAULT_STREAM_SYMBOLS)
  })

  it("puts watchlist equities first and dedupes against defaults", () => {
    const out = pickStreamSymbols(["PLTR", "TSLA"])
    expect(out[0]).toBe("PLTR")
    expect(out[1]).toBe("TSLA")
    expect(out.filter(s => s === "TSLA")).toHaveLength(1)
  })

  it("skips non-equity instruments (stream is Alpaca-backed)", () => {
    const out = pickStreamSymbols(["EUR/USD", "ES=F", "SPY250718C00550000", "AMD"])
    expect(out[0]).toBe("AMD")
    expect(out).not.toContain("EUR/USD")
    expect(out).not.toContain("ES=F")
  })

  it("caps the symbol count", () => {
    const many = Array.from({ length: 40 }, (_, i) => `SYM${i}`)
    expect(pickStreamSymbols(many, DEFAULT_STREAM_SYMBOLS, 25)).toHaveLength(25)
  })
})
