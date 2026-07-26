// Unit tests for the pure/deterministic parts of OandaAdapter (Phase 15).
// Network calls (quote/bars/place/positions/account) need real practice
// credentials and are verified manually per the phase plan, not here.

import { describe, it, expect, afterEach, vi } from "vitest"
import { toOandaInstrument, fromOandaInstrument, toOandaGranularity, OandaAdapter } from "./oanda"

describe("toOandaInstrument", () => {
  it("converts the canonical slash format", () => {
    expect(toOandaInstrument("EUR/USD")).toBe("EUR_USD")
  })
  it("passes through the underscore format", () => {
    expect(toOandaInstrument("eur_usd")).toBe("EUR_USD")
  })
  it("splits a bare 6-letter compact pair", () => {
    expect(toOandaInstrument("GBPJPY")).toBe("GBP_JPY")
  })
})

describe("fromOandaInstrument", () => {
  it("converts back to the canonical slash format", () => {
    expect(fromOandaInstrument("EUR_USD")).toBe("EUR/USD")
  })
})

describe("toOandaGranularity", () => {
  it("maps known Jarvis timeframe strings", () => {
    expect(toOandaGranularity("15Min")).toBe("M15")
    expect(toOandaGranularity("1Day")).toBe("D")
    expect(toOandaGranularity("4Hour")).toBe("H4")
  })
  it("falls back to M15 for unknown timeframes", () => {
    expect(toOandaGranularity("whatever")).toBe("M15")
  })
})

describe("OandaAdapter.isOpen", () => {
  afterEach(() => vi.useRealTimers())

  it("is closed on Saturday", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-07-25T12:00:00Z")) // Saturday
    expect(await OandaAdapter.isOpen()).toBe(false)
  })

  it("is closed Sunday before 22:00 UTC", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-07-26T10:00:00Z")) // Sunday
    expect(await OandaAdapter.isOpen()).toBe(false)
  })

  it("is open Sunday after 22:00 UTC", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-07-26T23:00:00Z")) // Sunday
    expect(await OandaAdapter.isOpen()).toBe(true)
  })

  it("is open on a weekday", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-07-22T15:00:00Z")) // Wednesday
    expect(await OandaAdapter.isOpen()).toBe(true)
  })

  it("is closed Friday after 22:00 UTC", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-07-24T23:00:00Z")) // Friday
    expect(await OandaAdapter.isOpen()).toBe(false)
  })
})
