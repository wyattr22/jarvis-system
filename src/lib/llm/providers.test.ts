// Guards: providers must throw before any network call when their API key
// is missing, so the router skips them cheaply instead of sending a 401.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { callProvider, MODELS, modelsByPriority } from "./providers"

vi.mock("@/lib/sandbox/whitelist", () => ({
  safeFetch: vi.fn(() => {
    throw new Error("network call attempted — guard failed")
  }),
}))

const KEY_VARS = ["GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_API_KEY", "OLLAMA_HOST"]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const v of KEY_VARS) {
    saved[v] = process.env[v]
    delete process.env[v]
  }
})

afterEach(() => {
  for (const v of KEY_VARS) {
    if (saved[v] === undefined) delete process.env[v]
    else process.env[v] = saved[v]
  }
})

describe("modelsByPriority", () => {
  it("puts cerebras-llama-70b first (most generous free tier)", () => {
    const [first] = modelsByPriority()
    expect(first[0]).toBe("cerebras-llama-70b")
  })

  it("orders strictly by the explicit priority field with no ties", () => {
    const priorities = modelsByPriority().map(([, m]) => m.priority)
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b))
    expect(new Set(priorities).size).toBe(priorities.length)
  })

  it("has no sambanova models left", () => {
    expect(Object.values(MODELS).some(m => (m.provider as string) === "sambanova")).toBe(false)
  })

  it("has no cloudflare models left (dead placeholder, removed Phase 19)", () => {
    expect(Object.values(MODELS).some(m => (m.provider as string) === "cloudflare")).toBe(false)
  })

  it("every model has a costTier (Phase 19)", () => {
    for (const [key, m] of Object.entries(MODELS)) {
      expect(["free-local", "cheap", "premium"], key).toContain(m.costTier)
    }
  })
})

describe("provider key guards", () => {
  it("groq throws before fetching when GROQ_API_KEY is missing", async () => {
    await expect(
      callProvider({ model: MODELS["groq-llama-70b"], messages: [] }),
    ).rejects.toThrow("GROQ_API_KEY not configured")
  })

  it("cerebras throws before fetching when CEREBRAS_API_KEY is missing", async () => {
    await expect(
      callProvider({ model: MODELS["cerebras-llama-70b"], messages: [] }),
    ).rejects.toThrow("CEREBRAS_API_KEY not configured")
  })

  it("openrouter throws before fetching when OPENROUTER_API_KEY is missing", async () => {
    await expect(
      callProvider({ model: MODELS["openrouter-deepseek-r1"], messages: [] }),
    ).rejects.toThrow("OPENROUTER_API_KEY not configured")
  })

  it("google throws before fetching when GOOGLE_API_KEY is missing", async () => {
    await expect(
      callProvider({ model: MODELS["google-gemini-flash"], messages: [] }),
    ).rejects.toThrow("GOOGLE_API_KEY not configured")
  })

  it("ollama throws before fetching when OLLAMA_HOST is missing — this is the exact behavior that lets it fail-and-fall-through cleanly in production, where OLLAMA_HOST is never set", async () => {
    await expect(
      callProvider({ model: MODELS["ollama-local"], messages: [] }),
    ).rejects.toThrow("OLLAMA_HOST not configured")
  })
})
