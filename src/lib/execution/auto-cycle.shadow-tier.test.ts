// Integration test for the Phase 18 safety gate: a strategy at capital_tier
// 0 (shadow) must NEVER have its signals executed by the auto-cycle, no
// matter what the allocator/risk-manager approved, while a tier-1 strategy's
// signal executes normally through the same cycle. This is the concrete
// proof that "unproven strategies can't silently trade real (paper)
// capital" holds in code, not just as a UI label — see DECISIONS.md.
//
// Uses a real in-memory libsql DB (not mocked SQL) so every module's actual
// queries run for real; only the DB connection and the broker adapter
// (which would otherwise make real network calls to Alpaca) are faked.

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

// Imported after the mocks so every module under test picks up the fakes.
const { runAutoCycle } = await import("./auto-cycle")
const { updateRiskConfig, seedDefaults } = await import("@/lib/allocator/risk-config")
const { listOpportunities } = await import("@/lib/opportunities/store")

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
}

async function insertStrategy(id: string, capitalTier: number) {
  await memDb.execute({
    sql: `INSERT INTO strategies (id, name, description, rules_json, enabled, weight, config_json, capital_tier, created_at)
          VALUES (?, ?, NULL, NULL, 1, 1.0, NULL, ?, ?)`,
    args: [id, id, capitalTier, Date.now()],
  })
}

// Wide stop (10% of entry) keeps position sizing well under the 50%
// equity/asset-class cap for two simultaneous equity opportunities --
// picked deliberately so neither trade is blocked by an unrelated
// pre-existing allocator cap, which would confound what this test is
// actually trying to prove.
async function insertSignal(id: string, strategyId: string, instrument: string) {
  await memDb.execute({
    sql: `INSERT INTO signals (id, strategy_id, instrument, direction, entry, stop, target, confidence, reasoning_json, status, created_at)
          VALUES (?, ?, ?, 'long', 100, 90, 120, 0.7, ?, 'pending', ?)`,
    args: [id, strategyId, instrument, JSON.stringify({ text: "test signal" }), Date.now()],
  })
}

describe("auto-cycle shadow-tier gate (Phase 18)", () => {
  beforeAll(async () => {
    await createSchema()
    await seedDefaults()
    await updateRiskConfig({ auto_execute: true, auto_max_orders_per_cycle: 10 })
    await insertStrategy("shadow-test-strategy", 0)
    await insertStrategy("control-test-strategy", 1)
    await insertSignal("sig-shadow-1", "shadow-test-strategy", "SHADW")
    await insertSignal("sig-control-1", "control-test-strategy", "CTRL")
  })

  it("promotes both signals to opportunities but only executes the tier-1 one", async () => {
    const result = await runAutoCycle()

    expect(result.enabled).toBe(true)
    expect(result.promoted).toBe(2)
    expect(result.vetoed).toBe(false)

    // The control (tier-1) opportunity executed.
    const controlExec = result.executed.find(e => e.symbol === "CTRL")
    expect(controlExec).toBeDefined()
    expect(controlExec?.ok).toBe(true)

    // The shadow (tier-0) opportunity was blocked BEFORE the execution loop
    // ever ran for it -- it shouldn't appear in `executed` at all, not even
    // as a failed attempt.
    const shadowExec = result.executed.find(e => e.symbol === "SHADW")
    expect(shadowExec).toBeUndefined()

    // fakeEquityAdapter.place() itself was only ever called for the control
    // trade -- the strongest possible proof nothing reached the broker for
    // the shadow one.
    expect(fakeEquityAdapter.place).toHaveBeenCalledTimes(1)
    expect(fakeEquityAdapter.place).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "CTRL" })
    )
  })

  it("leaves the shadow opportunity's status as open while the control one is executed", async () => {
    const opps = await listOpportunities({ status: "open", limit: 50 })
    const executedOpps = await listOpportunities({ status: "executed", limit: 50 })
    expect(opps.some(o => o.instrument === "SHADW")).toBe(true)
    expect(executedOpps.some(o => o.instrument === "CTRL")).toBe(true)
    expect(executedOpps.some(o => o.instrument === "SHADW")).toBe(false)
  })

  it("records an audit-log entry for the blocked shadow strategy", async () => {
    const res = await memDb.execute({
      sql: `SELECT actor, action, details_json FROM audit_log WHERE action = 'cycle_shadow_strategy_blocked'`,
      args: [],
    })
    expect(res.rows.length).toBeGreaterThan(0)
    const details = JSON.parse(String(res.rows[0].details_json))
    expect(details.strategy_id).toBe("shadow-test-strategy")
  })
})
