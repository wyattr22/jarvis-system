// Unit tests for the adapter registry.

import { describe, it, expect } from "vitest"
import { getAdapter, listAdapters } from "./index"

describe("getAdapter", () => {
  it("returns AlpacaAdapter for equity", () => {
    const a = getAdapter("equity")
    expect(a.id).toBe("alpaca")
    expect(a.assetClass).toBe("equity")
  })

  it("returns AlpacaAdapter for crypto (same broker)", () => {
    const a = getAdapter("crypto")
    expect(a.id).toBe("alpaca")
  })

  it("returns futures stub", () => {
    const a = getAdapter("futures")
    expect(a.id).toBe("futures-stub")
  })

  it("returns forex stub", () => {
    const a = getAdapter("forex")
    expect(a.id).toBe("forex-stub")
  })

  it("throws for unregistered asset classes", () => {
    expect(() => getAdapter("options")).toThrow(/no broker adapter/)
    expect(() => getAdapter("prediction")).toThrow(/no broker adapter/)
  })
})

describe("listAdapters", () => {
  it("returns every registered adapter", () => {
    const list = listAdapters()
    expect(list.length).toBeGreaterThanOrEqual(4)
    expect(list.map(a => a.assetClass).sort()).toContain("equity")
    expect(list.map(a => a.assetClass).sort()).toContain("futures")
  })
})
