import { describe, it, expect, vi, beforeEach } from "vitest"

const kv = new Map<string, unknown>()

vi.mock("@/lib/cache/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: unknown) => {
      kv.set(key, value)
      return "OK"
    }),
  },
}))

vi.mock("./budget", () => ({
  underBudget: vi.fn(async () => true),
}))

import { cachedQuote } from "./quote-cache"
import { underBudget } from "./budget"

beforeEach(() => {
  kv.clear()
  vi.clearAllMocks()
  vi.mocked(underBudget).mockResolvedValue(true)
})

describe("cachedQuote", () => {
  it("fetches on miss and writes cache + shadow", async () => {
    const fetcher = vi.fn(async () => ({ price: 42 }))
    const res = await cachedQuote("finnhub", "k1", 10, fetcher)
    expect(res).toEqual({ value: { price: 42 }, stale: false })
    expect(kv.has("quote:k1")).toBe(true)
    expect(kv.has("stale:k1")).toBe(true)
  })

  it("serves the fresh cache without fetching or spending budget", async () => {
    kv.set("quote:k1", { price: 7 })
    const fetcher = vi.fn()
    const res = await cachedQuote("finnhub", "k1", 10, fetcher)
    expect(res).toEqual({ value: { price: 7 }, stale: false })
    expect(fetcher).not.toHaveBeenCalled()
    expect(underBudget).not.toHaveBeenCalled()
  })

  it("serves the shadow marked stale when over budget", async () => {
    vi.mocked(underBudget).mockResolvedValue(false)
    kv.set("stale:k1", { price: 9 })
    const fetcher = vi.fn()
    const res = await cachedQuote("finnhub", "k1", 10, fetcher)
    expect(res).toEqual({ value: { price: 9 }, stale: true })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("fetches anyway when over budget with no shadow", async () => {
    vi.mocked(underBudget).mockResolvedValue(false)
    const fetcher = vi.fn(async () => ({ price: 3 }))
    const res = await cachedQuote("finnhub", "k1", 10, fetcher)
    expect(res).toEqual({ value: { price: 3 }, stale: false })
  })

  it("serves the shadow marked stale when the fetch throws", async () => {
    kv.set("stale:k1", { price: 5 })
    const fetcher = vi.fn(async () => {
      throw new Error("origin down")
    })
    const res = await cachedQuote("finnhub", "k1", 10, fetcher)
    expect(res).toEqual({ value: { price: 5 }, stale: true })
  })

  it("rethrows when the fetch throws and no shadow exists", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("origin down")
    })
    await expect(cachedQuote("finnhub", "k1", 10, fetcher)).rejects.toThrow("origin down")
  })
})
