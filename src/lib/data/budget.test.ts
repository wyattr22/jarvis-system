import { describe, it, expect, vi, beforeEach } from "vitest"

const store = new Map<string, number>()

vi.mock("@/lib/cache/redis", () => ({
  redis: {
    incr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1
      store.set(key, next)
      return next
    }),
    expire: vi.fn(async () => 1),
  },
}))

import { underBudget, BUDGETS } from "./budget"
import { redis } from "@/lib/cache/redis"

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe("underBudget", () => {
  it("allows requests under the limit", async () => {
    expect(await underBudget("finnhub")).toBe(true)
  })

  it("rejects requests past the limit within one window", async () => {
    const now = Date.now()
    for (let i = 0; i < BUDGETS.finnhub.limit; i++) {
      expect(await underBudget("finnhub", now)).toBe(true)
    }
    expect(await underBudget("finnhub", now)).toBe(false)
  })

  it("resets in the next window", async () => {
    const now = Date.now()
    for (let i = 0; i <= BUDGETS.finnhub.limit; i++) await underBudget("finnhub", now)
    expect(await underBudget("finnhub", now)).toBe(false)
    const nextWindow = now + BUDGETS.finnhub.windowSeconds * 1000
    expect(await underBudget("finnhub", nextWindow)).toBe(true)
  })

  it("always allows unknown providers", async () => {
    expect(await underBudget("unknown-provider")).toBe(true)
    expect(redis.incr).not.toHaveBeenCalled()
  })

  it("fails open when redis throws", async () => {
    vi.mocked(redis.incr).mockRejectedValueOnce(new Error("redis down"))
    expect(await underBudget("finnhub")).toBe(true)
  })
})
