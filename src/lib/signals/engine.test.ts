import { describe, it, expect } from "vitest"
import { inCooldown, COOLDOWN_MS } from "./engine"

describe("inCooldown", () => {
  const now = 1_800_000_000_000

  it("false when no prior signal", () => {
    expect(inCooldown(null, now)).toBe(false)
  })

  it("true inside the window, false after it", () => {
    expect(inCooldown(now - COOLDOWN_MS + 1000, now)).toBe(true)
    expect(inCooldown(now - COOLDOWN_MS - 1000, now)).toBe(false)
  })

  it("respects a custom window", () => {
    expect(inCooldown(now - 5_000, now, 10_000)).toBe(true)
    expect(inCooldown(now - 15_000, now, 10_000)).toBe(false)
  })
})
