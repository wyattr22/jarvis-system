import { describe, it, expect } from "vitest"
import { signalToOpportunity } from "./auto-cycle"

const base = {
  id: "sig-1",
  instrument: "AMD",
  direction: "long",
  entry: 100,
  stop: 97,
  target: 106,
  confidence: 0.7,
  reasoning_json: JSON.stringify({ text: "internal scan: FVG, OTE | RR 2.00 RSI 55" }),
}

describe("signalToOpportunity", () => {
  it("maps a long signal with expected R from target/stop distances", () => {
    const opp = signalToOpportunity(base)!
    expect(opp).toMatchObject({
      source: "jarvis",
      asset_class: "equity",
      instrument: "AMD",
      side: "long",
      entry_hint: 100,
      stop_hint: 97,
      confidence: 0.7,
    })
    expect(opp.expected_r).toBeCloseTo(2, 6)
    expect(opp.thesis).toContain("internal scan")
    expect(opp.source_payload).toEqual({ signal_id: "sig-1" })
  })

  it("maps shorts", () => {
    const opp = signalToOpportunity({ ...base, direction: "short", entry: 100, stop: 103, target: 94 })!
    expect(opp.side).toBe("short")
    expect(opp.expected_r).toBeCloseTo(2, 6)
  })

  it("rejects signals without a usable entry/stop", () => {
    expect(signalToOpportunity({ ...base, entry: null })).toBeNull()
    expect(signalToOpportunity({ ...base, stop: null })).toBeNull()
    expect(signalToOpportunity({ ...base, stop: 100 })).toBeNull() // zero risk
  })

  it("survives malformed reasoning JSON", () => {
    const opp = signalToOpportunity({ ...base, reasoning_json: "{broken" })!
    expect(opp.thesis).toContain("sig-1")
  })
})
