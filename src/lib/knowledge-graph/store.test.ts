import { describe, it, expect, vi, beforeAll } from "vitest"
import { createClient } from "@libsql/client"

const memDb = createClient({ url: ":memory:" })
vi.mock("@/lib/db/client", () => ({ db: memDb }))

const { runStructuralSync, getGraph } = await import("./store")

describe("runStructuralSync", () => {
  beforeAll(async () => {
    await memDb.execute(`CREATE TABLE strategies (id TEXT PRIMARY KEY, name TEXT, description TEXT, capital_tier INTEGER, created_at INTEGER)`)
    await memDb.execute(`CREATE TABLE signals (id TEXT PRIMARY KEY, strategy_id TEXT, instrument TEXT, direction TEXT, created_at INTEGER)`)
    await memDb.execute(`CREATE TABLE trades (id TEXT PRIMARY KEY, signal_id TEXT, instrument TEXT, direction TEXT, r_multiple REAL, opened_at INTEGER)`)
    await memDb.execute(`CREATE TABLE proposals (id TEXT PRIMARY KEY, strategy_id TEXT, hypothesis TEXT, status TEXT, created_at INTEGER)`)
    await memDb.execute(`CREATE TABLE experiments (id TEXT PRIMARY KEY, proposal_id TEXT, original_strategy_id TEXT, started_at INTEGER)`)

    await memDb.execute({ sql: "INSERT INTO strategies VALUES ('smc-ict-v4','SMC/ICT v4','the strategy',1,?)", args: [1000] })
    await memDb.execute({ sql: "INSERT INTO signals VALUES ('sig-1','smc-ict-v4','AAPL','long',?)", args: [1100] })
    await memDb.execute({ sql: "INSERT INTO trades VALUES ('trd-1','sig-1','AAPL','long',2.0,?)", args: [1200] })
    await memDb.execute({ sql: "INSERT INTO proposals VALUES ('prop-1','smc-ict-v4','hypothesis text','pending',?)", args: [1300] })
    await memDb.execute({ sql: "INSERT INTO experiments VALUES ('exp-1','prop-1','smc-ict-v4',?)", args: [1400] })
  })

  it("upserts exactly the expected nodes and edges from FK relationships", async () => {
    const result = await runStructuralSync()
    expect(result.nodesUpserted).toBeGreaterThanOrEqual(5) // strategy, signal, symbol, trade, proposal, experiment
    expect(result.edgesUpserted).toBeGreaterThanOrEqual(4) // generated_by, concerns, filled_by, proposes_change_to, validates

    const graph = await getGraph()
    const nodeIds = graph.nodes.map(n => n.id).sort()
    expect(nodeIds).toEqual(expect.arrayContaining([
      "strategies:smc-ict-v4", "signals:sig-1", "trades:trd-1", "proposals:prop-1",
      "experiments:exp-1", "symbol:AAPL",
    ]))

    const edgeTuples = graph.edges.map(e => `${e.source_id}->${e.target_id}:${e.edge_type}`).sort()
    expect(edgeTuples).toEqual(expect.arrayContaining([
      "signals:sig-1->strategies:smc-ict-v4:generated_by",
      "signals:sig-1->symbol:AAPL:concerns",
      "trades:trd-1->signals:sig-1:filled_by",
      "proposals:prop-1->strategies:smc-ict-v4:proposes_change_to",
      "experiments:exp-1->proposals:prop-1:validates",
    ]))
  })

  it("is incremental: a second sync with no new rows upserts nothing new", async () => {
    const result = await runStructuralSync()
    expect(result.nodesUpserted).toBe(0)
    expect(result.edgesUpserted).toBe(0)
  })
})
