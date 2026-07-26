// The single most important test added in this plan (Phase 20): proves the
// Phase 18 shadow-tier gate still holds once a strategy has gone through
// the REAL "new_strategy" proposal approval path (PATCH /api/proposals/[id])
// -- not just when a human inserts a tier-0 row by hand in a test, which is
// what auto-cycle.shadow-tier.test.ts (Phase 18) already covers.
//
// Flow exercised: a draft strategy row at capital_tier 0 (as the
// orchestrator creates for any new_strategy proposal) -> approve its
// proposal via the real PATCH route handler (which flips enabled to 1,
// exactly as a human clicking "approve" on /proposals would trigger) ->
// confirm capital_tier is STILL 0 -> run the auto-cycle and confirm its
// signal still cannot reach a broker, while a tier-1 strategy's signal
// executes normally in the same cycle.

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createClient } from "@libsql/client"

const memDb = createClient({ url: ":memory:" })
vi.mock("@/lib/db/client", () => ({ db: memDb }))

const fakeEquityAdapter = {
  id: "fake-equity",
  assetClass: "equity" as const,
  displayName: "Fake equity adapter (test)",
  quote: async () => { throw new Error("not used in this test") },
  bars: async () => [],
  place: vi.fn(async () => ({ ok: true, broker: "fake-equity", order_id: `fake-${Math.random()}`, status: "filled" })),
  positions: async () => [],
  account: async () => ({
    broker: "fake-equity", equity: 100_000, cash: 100_000, buying_power: 100_000,
    day_pnl: 0, currency: "USD", daytrade_count: 0,
  }),
  isOpen: async () => true,
}
vi.mock("@/lib/brokers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brokers")>()
  return {
    ...actual,
    getAdapter: (cls: string) => {
      if (cls === "equity") return fakeEquityAdapter
      throw new Error(`no broker adapter registered for asset class: ${cls}`)
    },
  }
})

const { runAutoCycle } = await import("./auto-cycle")
const { updateRiskConfig, seedDefaults } = await import("@/lib/allocator/risk-config")
const { PATCH } = await import("@/app/api/proposals/[id]/route")

async function createSchema() {
  await memDb.execute(`
    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, rules_json TEXT,
      enabled INTEGER DEFAULT 1, weight REAL DEFAULT 1.0, config_json TEXT,
      capital_tier INTEGER DEFAULT 1, created_at INTEGER NOT NULL
    )`)
  await memDb.execute(`
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY, strategy_id TEXT REFERENCES strategies(id),
      instrument TEXT NOT NULL, direction TEXT NOT NULL,
      entry REAL, stop REAL, target REAL, confidence REAL,
      reasoning_json TEXT, feature_snapshot_json TEXT,
      status TEXT DEFAULT 'pending', created_at INTEGER NOT NULL
    )`)
  await memDb.execute(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
      details_json TEXT, timestamp INTEGER NOT NULL
    )`)
  await memDb.execute(`
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, strategy_id TEXT, hypothesis TEXT,
      proposed_change_json TEXT, evidence_json TEXT, status TEXT DEFAULT 'pending',
      reviewer_notes TEXT, decided_at INTEGER, created_at INTEGER
    )`)
}

describe("new_strategy proposal approval cannot bypass the shadow-tier gate (Phase 20)", () => {
  beforeAll(async () => {
    await createSchema()
    await seedDefaults()
    await updateRiskConfig({ auto_execute: true, auto_max_orders_per_cycle: 10 })

    // Simulate exactly what the orchestrator does for a new_strategy
    // proposal: a draft strategies row at capital_tier 0, enabled 0.
    await memDb.execute({
      sql: `INSERT INTO strategies (id, name, description, rules_json, enabled, weight, config_json, capital_tier, created_at)
            VALUES ('llm-authored-candidate', 'llm-authored-candidate', 'LLM-authored candidate', NULL, 0, 1.0, NULL, 0, ?)`,
      args: [Date.now()],
    })
    await memDb.execute({
      sql: `INSERT INTO proposals (id, strategy_id, hypothesis, proposed_change_json, evidence_json, status, created_at)
            VALUES ('prop-test-1', 'llm-authored-candidate', 'test hypothesis', ?, NULL, 'pending', ?)`,
      args: [JSON.stringify({ type: "new_strategy", description: "test" }), Date.now()],
    })
    await memDb.execute({
      sql: `INSERT INTO strategies (id, name, description, rules_json, enabled, weight, config_json, capital_tier, created_at)
            VALUES ('control-test-strategy', 'control-test-strategy', NULL, NULL, 1, 1.0, NULL, 1, ?)`,
      args: [Date.now()],
    })
    await memDb.execute({
      sql: `INSERT INTO signals (id, strategy_id, instrument, direction, entry, stop, target, confidence, reasoning_json, status, created_at)
            VALUES ('sig-llm-1', 'llm-authored-candidate', 'LLMCAND', 'long', 100, 90, 120, 0.7, ?, 'pending', ?)`,
      args: [JSON.stringify({ text: "test" }), Date.now()],
    })
    await memDb.execute({
      sql: `INSERT INTO signals (id, strategy_id, instrument, direction, entry, stop, target, confidence, reasoning_json, status, created_at)
            VALUES ('sig-control-1', 'control-test-strategy', 'CTRL', 'long', 100, 90, 120, 0.7, ?, 'pending', ?)`,
      args: [JSON.stringify({ text: "test" }), Date.now()],
    })
  })

  it("approving the proposal enables the strategy but does not touch capital_tier", async () => {
    const req = new Request("http://localhost/api/proposals/prop-test-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "prop-test-1" }) })
    expect(res.status).toBe(200)

    const row = await memDb.execute({
      sql: "SELECT enabled, capital_tier FROM strategies WHERE id = 'llm-authored-candidate'",
      args: [],
    })
    expect(Number(row.rows[0].enabled)).toBe(1)
    expect(Number(row.rows[0].capital_tier)).toBe(0) // approval does NOT promote capital_tier
  })

  it("the now-enabled tier-0 strategy's signal still cannot reach the broker, while the tier-1 control's does", async () => {
    const result = await runAutoCycle()

    expect(result.promoted).toBe(2)
    const controlExec = result.executed.find(e => e.symbol === "CTRL")
    expect(controlExec?.ok).toBe(true)

    const llmExec = result.executed.find(e => e.symbol === "LLMCAND")
    expect(llmExec).toBeUndefined()

    expect(fakeEquityAdapter.place).toHaveBeenCalledTimes(1)
    expect(fakeEquityAdapter.place).toHaveBeenCalledWith(expect.objectContaining({ symbol: "CTRL" }))

    const blocked = await memDb.execute({
      sql: "SELECT details_json FROM audit_log WHERE action = 'cycle_shadow_strategy_blocked'",
      args: [],
    })
    expect(blocked.rows.length).toBeGreaterThan(0)
    expect(JSON.parse(String(blocked.rows[0].details_json)).strategy_id).toBe("llm-authored-candidate")
  })
})
