// Phase 19: cost-tier candidate filtering, and the router's existing
// fall-through-on-error behavior applied to a local Ollama candidate that's
// unreachable (which is exactly what happens in production, where
// OLLAMA_HOST is never set) -- proving no special-casing was needed there.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/cache/redis", () => ({
  redis: {
    get: vi.fn(async () => null),
    setex: vi.fn(async () => {}),
    incrby: vi.fn(async () => {}),
    expire: vi.fn(async () => {}),
  },
}))

const callProviderMock = vi.fn()
vi.mock("./providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers")>()
  return { ...actual, callProvider: (...args: unknown[]) => callProviderMock(...args) }
})

const { route } = await import("./router")
const { MODELS } = await import("./providers")

describe("cost-tier candidate filtering", () => {
  beforeEach(() => callProviderMock.mockReset())

  it("routes to a cheap-tier model when preferredCostTier is 'cheap'", async () => {
    callProviderMock.mockResolvedValue("ok")
    await route({ messages: [{ role: "user", content: "hi" }], preferredCostTier: "cheap", cacheable: false })
    const usedModel = callProviderMock.mock.calls[0][0].model
    expect(usedModel.costTier).toBe("cheap")
  })

  it("routes to the premium-tier model when preferredCostTier is 'premium'", async () => {
    callProviderMock.mockResolvedValue("ok")
    await route({ messages: [{ role: "user", content: "hi" }], preferredCostTier: "premium", cacheable: false })
    const usedModel = callProviderMock.mock.calls[0][0].model
    expect(usedModel.costTier).toBe("premium")
    expect(usedModel.provider).toBe("openrouter") // only premium entry today
  })

  it("an explicit preferredModel wins over preferredCostTier", async () => {
    callProviderMock.mockResolvedValue("ok")
    await route({
      messages: [{ role: "user", content: "hi" }],
      preferredModel: "groq-llama-8b",
      preferredCostTier: "premium",
      cacheable: false,
    })
    const usedModel = callProviderMock.mock.calls[0][0].model
    expect(usedModel).toEqual(MODELS["groq-llama-8b"])
  })
})

describe("local Ollama candidate falls through cleanly when unreachable", () => {
  beforeEach(() => callProviderMock.mockReset())

  it("falls through to the next candidate on a simulated connection failure, with no special-casing", async () => {
    callProviderMock.mockImplementation(async (...allArgs: unknown[]) => {
      // Defensive: vitest's own test-cleanup machinery appears to probe this
      // mock once more with no arguments after the test body has already
      // resolved (observed via a stack trace through callCleanupHooks, not
      // through router.ts) -- unrelated to what this test is verifying, so
      // treat a malformed/argument-less invocation as a no-op rather than
      // letting it manifest as a spurious failure.
      const req = allArgs[0] as { model: { provider: string } } | undefined
      if (!req?.model) return "ignored-cleanup-probe"
      if (req.model.provider === "ollama") throw new Error("OLLAMA_HOST not configured")
      return "ok from fallback"
    })
    const result = await route({
      messages: [{ role: "user", content: "hi" }],
      preferredModel: "ollama-local",
      cacheable: false,
    })
    expect(result).toBe("ok from fallback")
    // Tried ollama first (as preferred), then fell through to something else.
    expect(callProviderMock.mock.calls[0][0].model.provider).toBe("ollama")
    expect(callProviderMock.mock.calls.length).toBeGreaterThan(1)
  })
})
