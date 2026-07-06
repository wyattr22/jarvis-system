import { describe, it, expect } from "vitest"
import { parseInstrument } from "./parse"
import { formatInstrument } from "./format"

describe("parseInstrument — OCC options", () => {
  it("parses a standard OCC symbol", () => {
    const p = parseInstrument("SPY250718C00550000")
    expect(p).toMatchObject({
      assetClass: "options",
      underlying: "SPY",
      expiry: "2025-07-18",
      strike: 550,
      right: "C",
      multiplier: 100,
    })
  })

  it("parses puts, fractional strikes and long roots", () => {
    const p = parseInstrument("GOOGL260116P01234500")
    expect(p).toMatchObject({
      assetClass: "options",
      underlying: "GOOGL",
      expiry: "2026-01-16",
      strike: 1234.5,
      right: "P",
    })
  })

  it("rejects OCC-lookalikes with impossible dates", () => {
    const p = parseInstrument("SPY251340C00550000") // month 13, day 40
    expect(p.assetClass).toBe("equity")
  })
})

describe("parseInstrument — futures", () => {
  it("parses Yahoo continuous contracts", () => {
    const p = parseInstrument("ES=F")
    expect(p).toMatchObject({ assetClass: "futures", underlying: "ES", multiplier: 50 })
    expect(p.expiry).toBeUndefined()
  })

  it("parses dated contracts with 2-digit years", () => {
    const p = parseInstrument("ESU26")
    expect(p).toMatchObject({
      assetClass: "futures",
      underlying: "ES",
      contractMonth: "U26",
      expiry: "2026-09",
      multiplier: 50,
    })
  })

  it("parses gold with the COMEX multiplier", () => {
    expect(parseInstrument("GCZ26")).toMatchObject({
      assetClass: "futures",
      underlying: "GC",
      expiry: "2026-12",
      multiplier: 100,
    })
  })

  it("does not misparse plain tickers as futures (unknown root)", () => {
    expect(parseInstrument("ABF5").assetClass).toBe("equity") // AB not a known root
    expect(parseInstrument("F").assetClass).toBe("equity")
  })
})

describe("parseInstrument — forex", () => {
  it("normalizes all three notations to XXX/YYY", () => {
    for (const raw of ["EUR/USD", "EUR_USD", "EURUSD"]) {
      expect(parseInstrument(raw)).toMatchObject({ assetClass: "forex", underlying: "EUR/USD" })
    }
  })

  it("does not treat 6-letter tickers as forex unless both halves are currencies", () => {
    expect(parseInstrument("GOOGLE").assetClass).toBe("equity")
    expect(parseInstrument("NVDAXX").assetClass).toBe("equity")
  })

  it("handles crypto pairs", () => {
    expect(parseInstrument("BTC/USD")).toMatchObject({ assetClass: "forex", underlying: "BTC/USD" })
  })
})

describe("parseInstrument — fallthrough + hints", () => {
  it("plain tickers fall through to equity", () => {
    expect(parseInstrument("TSLA")).toMatchObject({ assetClass: "equity", underlying: "TSLA" })
  })

  it("respects an explicit asset-class hint on ambiguous strings", () => {
    expect(parseInstrument("SOMETHING", "prediction").assetClass).toBe("prediction")
  })

  it("uppercases and trims", () => {
    expect(parseInstrument(" tsla ").underlying).toBe("TSLA")
  })
})

describe("formatInstrument", () => {
  it("renders options human-readably", () => {
    expect(formatInstrument(parseInstrument("SPY250718C00550000"))).toBe("SPY 18 Jul '25 $550 Call")
    expect(formatInstrument(parseInstrument("GOOGL260116P01234500"))).toBe("GOOGL 16 Jan '26 $1234.5 Put")
  })

  it("renders futures with catalog labels", () => {
    expect(formatInstrument(parseInstrument("ES=F"))).toBe("S&P 500 E-mini (cont.)")
    expect(formatInstrument(parseInstrument("ESU26"))).toBe("S&P 500 E-mini Sep '26")
  })

  it("renders forex as the normalized pair and equity as raw", () => {
    expect(formatInstrument(parseInstrument("EURUSD"))).toBe("EUR/USD")
    expect(formatInstrument(parseInstrument("TSLA"))).toBe("TSLA")
  })
})
