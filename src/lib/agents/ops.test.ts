import { describe, it, expect } from "vitest"
import { heartbeatStatus } from "./ops"

const H = 3_600_000
const MONDAY = Date.parse("2026-07-06T12:00:00Z") // Monday
const WEDNESDAY = Date.parse("2026-07-08T12:00:00Z")

describe("heartbeatStatus", () => {
  it("never-seen is down", () => {
    expect(heartbeatStatus(null, 24, false)).toBe("down")
  })

  it("fresh is ok, stale is warn, ancient is down (midweek)", () => {
    expect(heartbeatStatus(WEDNESDAY - 10 * H, 24, false, WEDNESDAY)).toBe("ok")
    expect(heartbeatStatus(WEDNESDAY - 30 * H, 24, false, WEDNESDAY)).toBe("warn")
    expect(heartbeatStatus(WEDNESDAY - 100 * H, 24, false, WEDNESDAY)).toBe("down")
  })

  it("market-hours subsystems get weekend slack on Mondays", () => {
    // 60h old on a Monday (last ran Friday) — fine for market-hours actors
    expect(heartbeatStatus(MONDAY - 60 * H, 30, true, MONDAY)).toBe("ok")
    // but a non-market actor with the same age is warn
    expect(heartbeatStatus(MONDAY - 60 * H, 30, false, MONDAY)).toBe("warn")
  })
})
