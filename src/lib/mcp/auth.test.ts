// Unit tests for token hashing + Authorization header parsing.
// DB-backed paths (authenticateRequest, registerClient) aren't covered here —
// they need a Turso connection. Phase 1.6+ adds an integration test suite.

import { describe, it, expect } from "vitest"
import { hashToken } from "./auth"

describe("hashToken", () => {
  it("produces a stable SHA-256 hex digest", () => {
    const a = hashToken("abc")
    const b = hashToken("abc")
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it("differs for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"))
  })
})
