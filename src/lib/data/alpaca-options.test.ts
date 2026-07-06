import { describe, it, expect, vi, beforeEach } from "vitest"

const fetchMock = vi.fn()
vi.mock("@/lib/sandbox/whitelist", () => ({
  safeFetch: (...args: unknown[]) => fetchMock(...args),
}))

import { getAlpacaChain, targetExpiryWindow } from "./alpaca-options"

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

const CONTRACTS = {
  option_contracts: [
    { symbol: "SPY260713C00740000", type: "call", strike_price: "740", expiration_date: "2026-07-13", open_interest: "810" },
    { symbol: "SPY260713P00735000", type: "put", strike_price: "735", expiration_date: "2026-07-13", open_interest: "600" },
    { symbol: "SPY260713C00737000", type: "call", strike_price: "737", expiration_date: "2026-07-13", open_interest: null },
    { symbol: "SPY260715C00740000", type: "call", strike_price: "740", expiration_date: "2026-07-15", open_interest: "5" },
  ],
}

const SNAPSHOTS = {
  snapshots: {
    SPY260713C00740000: { impliedVolatility: 0.22, latestQuote: { t: "2026-07-06T15:00:00Z" } },
  },
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe("targetExpiryWindow", () => {
  it("spans 5-12 days out", () => {
    const now = new Date("2026-07-06T00:00:00Z")
    const { gte, lte } = targetExpiryWindow(now)
    expect(gte).toBe("2026-07-11")
    expect(lte).toBe("2026-07-18")
  })
})

describe("getAlpacaChain", () => {
  it("picks the highest-OI expiry, joins IV, drops zero-OI contracts", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(CONTRACTS)) // contracts
      .mockResolvedValueOnce(jsonResponse(SNAPSHOTS)) // snapshots
    const chain = await getAlpacaChain("SPY", 743)
    expect(chain).not.toBeNull()
    expect(chain!.expiry).toBe("2026-07-13")
    expect(chain!.contracts).toHaveLength(2) // zero-OI 737C dropped, other expiry dropped
    const call = chain!.contracts.find(c => c.right === "C")!
    expect(call.strike).toBe(740)
    expect(call.openInterest).toBe(810)
    expect(call.impliedVolatility).toBeCloseTo(0.22)
    expect(chain!.asOf).toBe("2026-07-06T15:00:00Z")
  })

  it("returns null when the contracts API fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false))
    expect(await getAlpacaChain("SPY", 743)).toBeNull()
  })

  it("returns null when every contract has zero OI", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        option_contracts: [
          { symbol: "X", type: "call", strike_price: "10", expiration_date: "2026-07-13", open_interest: null },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ snapshots: {} }))
    expect(await getAlpacaChain("X", 10)).toBeNull()
  })

  it("survives a failed snapshots call (IV enrichment optional)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(CONTRACTS))
      .mockResolvedValueOnce(jsonResponse({}, false))
    const chain = await getAlpacaChain("SPY", 743)
    expect(chain).not.toBeNull()
    expect(chain!.contracts.find(c => c.right === "C")!.impliedVolatility).toBeUndefined()
  })
})
