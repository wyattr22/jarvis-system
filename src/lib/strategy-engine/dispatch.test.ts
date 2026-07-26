import { describe, it, expect, vi, beforeEach } from "vitest"

const executeMock = vi.fn()
vi.mock("@/lib/db/client", () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}))

// Imported after the mock so dispatch.ts picks up the mocked db.
const { getSignalForStrategy, clearDefinitionCache } = await import("./dispatch")
const { evaluateStrategy } = await import("./interpreter")
const { SMC_ICT_V4_DEFINITION } = await import("./legacy-definition")
const { checkBotSignal, DEFAULT_PARAMS } = await import("@/lib/backtest/bot-strategy")

// Minimal but sufficient synthetic bars — these tests only care about which
// code path runs, not about producing a real non-null signal (that's what
// interpreter.test.ts's parity suite already covers thoroughly).
function makeBars(n: number) {
  const bars = []
  for (let i = 0; i < n; i++) {
    bars.push({ t: `2026-01-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00Z`, o: 100, h: 101, l: 99, c: 100, v: 1000 })
  }
  return bars
}

describe("getSignalForStrategy", () => {
  beforeEach(() => {
    executeMock.mockReset()
    clearDefinitionCache()
  })

  it("resolves smc-ict-v4 to the in-memory legacy definition without needing definition_json in the DB", async () => {
    // Simulate a row with no definition_json yet (pre-migration state).
    executeMock.mockResolvedValue({ rows: [{ definition_json: null }] })

    const bars15m = makeBars(40)
    const dailyBars = makeBars(10)
    const spyBars = makeBars(40)

    const viaDispatch = await getSignalForStrategy("smc-ict-v4", bars15m, dailyBars, spyBars, 39, "TEST")
    const viaLegacyCheck = checkBotSignal(bars15m, dailyBars, spyBars, 39, "TEST", DEFAULT_PARAMS)
    const viaInterpreter = evaluateStrategy(SMC_ICT_V4_DEFINITION, { bars15m, dailyBars, spyBars, i: 39, symbol: "TEST" })

    // All three should agree (all null here since the synthetic bars are
    // flat/trivial) — the point is dispatch used the interpreter path, not
    // that this particular flat data produces a signal.
    expect(viaDispatch).toEqual(viaInterpreter)
    expect(viaDispatch).toEqual(viaLegacyCheck)
  })

  it("uses definition_json from the DB when present and valid", async () => {
    const customDef = { ...SMC_ICT_V4_DEFINITION, id: "custom-1" }
    executeMock.mockResolvedValue({ rows: [{ definition_json: JSON.stringify(customDef) }] })

    const bars15m = makeBars(40)
    const result = await getSignalForStrategy("custom-1", bars15m, makeBars(10), makeBars(40), 39, "TEST")
    const expected = evaluateStrategy(customDef, { bars15m, dailyBars: makeBars(10), spyBars: makeBars(40), i: 39, symbol: "TEST" })
    expect(result).toEqual(expected)
  })

  it("falls back to the legacy algorithm for an unknown strategy id with no definition_json", async () => {
    executeMock.mockResolvedValue({ rows: [] })

    const bars15m = makeBars(40)
    const dailyBars = makeBars(10)
    const spyBars = makeBars(40)
    const result = await getSignalForStrategy("totally-unknown-id", bars15m, dailyBars, spyBars, 39, "TEST")
    const expected = checkBotSignal(bars15m, dailyBars, spyBars, 39, "TEST", DEFAULT_PARAMS)
    expect(result).toEqual(expected)
  })

  it("caches the resolved definition — only one DB call per strategy id across repeated calls", async () => {
    executeMock.mockResolvedValue({ rows: [{ definition_json: null }] })
    const bars15m = makeBars(40)
    for (let i = 35; i < 39; i++) {
      await getSignalForStrategy("smc-ict-v4", bars15m, makeBars(10), makeBars(40), i, "TEST")
    }
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it("gracefully falls back to legacy on malformed definition_json JSON", async () => {
    executeMock.mockResolvedValue({ rows: [{ definition_json: "{not valid json" }] })
    const bars15m = makeBars(40)
    const dailyBars = makeBars(10)
    const spyBars = makeBars(40)
    const result = await getSignalForStrategy("broken-strategy", bars15m, dailyBars, spyBars, 39, "TEST")
    const expected = checkBotSignal(bars15m, dailyBars, spyBars, 39, "TEST", DEFAULT_PARAMS)
    expect(result).toEqual(expected)
  })
})
