import { describe, it, expect } from "vitest"
import { freshnessOf, metaFor, SOURCE_DELAYS, type QuoteMeta } from "./freshness"

const NOW = Date.parse("2026-07-06T15:00:00Z")

function meta(overrides: Partial<QuoteMeta> = {}): QuoteMeta {
  return {
    source: "alpaca.iex",
    asOf: new Date(NOW - 1000).toISOString(),
    delaySeconds: 0,
    realtime: true,
    ...overrides,
  }
}

describe("freshnessOf", () => {
  it("classifies a fresh realtime print as realtime", () => {
    expect(freshnessOf(meta(), NOW)).toBe("realtime")
  })

  it("classifies a 59s-old realtime print as realtime", () => {
    expect(freshnessOf(meta({ asOf: new Date(NOW - 59_000).toISOString() }), NOW)).toBe("realtime")
  })

  it("degrades a 61s-old print from a realtime source to delayed", () => {
    expect(freshnessOf(meta({ asOf: new Date(NOW - 61_000).toISOString() }), NOW)).toBe("delayed")
  })

  it("classifies a delayed-feed print as delayed even when fresh", () => {
    expect(
      freshnessOf(meta({ source: "yahoo.futures", delaySeconds: 900, realtime: false }), NOW),
    ).toBe("delayed")
  })

  it("classifies prints older than a day as eod", () => {
    const dayOld = new Date(NOW - 24 * 60 * 60 * 1000).toISOString()
    expect(freshnessOf(meta({ asOf: dayOld }), NOW)).toBe("eod")
  })

  it("treats an unparseable timestamp as eod", () => {
    expect(freshnessOf(meta({ asOf: "" }), NOW)).toBe("eod")
  })
})

describe("metaFor", () => {
  it("applies the registered source delay spec", () => {
    const m = metaFor("yahoo.futures", "2026-07-06T14:00:00Z")
    expect(m.delaySeconds).toBe(SOURCE_DELAYS["yahoo.futures"].delaySeconds)
    expect(m.realtime).toBe(false)
  })

  it("defaults unknown sources to delayed, never realtime", () => {
    const m = metaFor("mystery.provider", "2026-07-06T14:00:00Z")
    expect(m.realtime).toBe(false)
    expect(m.delaySeconds).toBeGreaterThan(0)
  })
})
