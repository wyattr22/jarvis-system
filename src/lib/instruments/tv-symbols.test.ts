import { describe, it, expect } from "vitest"
import { toTradingViewSymbol } from "./tv-symbols"

describe("toTradingViewSymbol", () => {
  it("maps indexes", () => {
    expect(toTradingViewSymbol("^GSPC")).toBe("SP:SPX")
    expect(toTradingViewSymbol("^VIX")).toBe("TVC:VIX")
    expect(toTradingViewSymbol("DX-Y.NYB")).toBe("TVC:DXY")
  })

  it("maps futures to continuous front-month contracts", () => {
    expect(toTradingViewSymbol("ES=F")).toBe("CME_MINI:ES1!")
    expect(toTradingViewSymbol("GC=F")).toBe("COMEX:GC1!")
    expect(toTradingViewSymbol("6E=F")).toBe("CME:6E1!")
  })

  it("maps forex in both notations", () => {
    expect(toTradingViewSymbol("EURUSD=X")).toBe("FX:EURUSD")
    expect(toTradingViewSymbol("EUR/USD")).toBe("FX:EURUSD")
  })

  it("passes equities through unchanged", () => {
    expect(toTradingViewSymbol("AAPL")).toBe("AAPL")
    expect(toTradingViewSymbol("spy")).toBe("SPY")
  })
})
