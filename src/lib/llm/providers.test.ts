// Guards: providers must throw before any network call when their API key
// is missing, so the router skips them cheaply instead of sending a 401.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { callProvider, MODELS } from "./providers"

vi.mock("@/lib/sandbox/whitelist", () => ({
  safeFetch: vi.fn(() => {
    throw new Error("network call attempted — guard failed")
  }),
}))

const KEY_VARS = ["GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY"]
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
})
