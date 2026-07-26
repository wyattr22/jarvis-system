// Knowledge-graph "brain" (Phase 21) — nodes + edges derived from Jarvis's
// own data, browsable as a force-directed graph and exportable as an
// Obsidian-compatible markdown vault.
//
// Structural extraction (this file) is pure SQL over existing FK
// relationships — zero LLM cost, zero hallucination risk, and alone already
// a genuinely useful "what has Jarvis done and why" graph. LLM-based
// extraction over free text (research_notes/daily_digests/jarvis_memory) is
// a separate, later addition (see KNOWN_ISSUES.md) — deliberately not
// bundled into this phase so the always-correct structural layer ships
// first and isn't gated on getting prompt/quota tuning right.

import { db } from "@/lib/db/client"

export type NodeType =
  | "strategy" | "signal" | "trade" | "proposal" | "experiment" | "symbol"
export type EdgeType =
  | "generated_by" | "filled_by" | "proposes_change_to" | "validates" | "concerns"

export interface KgNode {
  id: string
  node_type: NodeType
  label: string
  ref_table: string | null
  ref_id: string | null
  summary: string | null
  metadata_json: string | null
  created_at: number
  updated_at: number
}

export interface KgEdge {
  id: string
  source_id: string
  target_id: string
  edge_type: EdgeType
  weight: number
  extracted_by: "structural" | "llm"
  created_at: number
}

let tableReady = false
async function ensureTables(): Promise<void> {
  if (tableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS kg_nodes (
      id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      label TEXT NOT NULL,
      ref_table TEXT,
      ref_id TEXT,
      summary TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS kg_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      extracted_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_edge_unique ON kg_edges(source_id, target_id, edge_type)`)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS kg_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_synced_at INTEGER NOT NULL
    )
  `)
  tableReady = true
}

async function getLastSyncedAt(): Promise<number> {
  await ensureTables()
  const r = await db.execute({ sql: "SELECT last_synced_at FROM kg_sync_state WHERE id = 1", args: [] })
  return r.rows.length ? Number(r.rows[0].last_synced_at) : 0
}

async function setLastSyncedAt(ts: number): Promise<void> {
  await db.execute({
    sql: "INSERT OR REPLACE INTO kg_sync_state (id, last_synced_at) VALUES (1, ?)",
    args: [ts],
  })
}

async function upsertNode(node: Omit<KgNode, "created_at" | "updated_at"> & { created_at?: number }): Promise<void> {
  const now = Date.now()
  await db.execute({
    sql: `INSERT INTO kg_nodes (id, node_type, label, ref_table, ref_id, summary, metadata_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            label = excluded.label, summary = excluded.summary,
            metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
    args: [
      node.id, node.node_type, node.label, node.ref_table, node.ref_id,
      node.summary, node.metadata_json, node.created_at ?? now, now,
    ],
  })
}

async function upsertEdge(sourceId: string, targetId: string, edgeType: EdgeType, extractedBy: "structural" | "llm" = "structural", weight = 1.0): Promise<void> {
  await db.execute({
    sql: `INSERT INTO kg_edges (id, source_id, target_id, edge_type, weight, extracted_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, target_id, edge_type) DO NOTHING`,
    args: [`edge-${sourceId}-${targetId}-${edgeType}`, sourceId, targetId, edgeType, weight, extractedBy, Date.now()],
  })
}

function symbolNodeId(instrument: string): string {
  return `symbol:${instrument.toUpperCase()}`
}

export interface StructuralSyncResult {
  nodesUpserted: number
  edgesUpserted: number
  since: number
  until: number
}

/**
 * Structural sync: every FK relationship already in the schema becomes a
 * node + edge via plain SQL, incremental since the last sync. No LLM calls.
 */
export async function runStructuralSync(): Promise<StructuralSyncResult> {
  await ensureTables()
  const since = await getLastSyncedAt()
  const until = Date.now()
  let nodesUpserted = 0
  let edgesUpserted = 0
  const symbolsSeen = new Set<string>()

  const strategies = await db.execute({
    sql: "SELECT id, name, description, capital_tier, created_at FROM strategies WHERE created_at > ?",
    args: [since],
  })
  for (const r of strategies.rows) {
    await upsertNode({
      id: `strategies:${r.id}`, node_type: "strategy", label: String(r.name ?? r.id),
      ref_table: "strategies", ref_id: String(r.id),
      summary: r.description ? String(r.description) : null,
      metadata_json: JSON.stringify({ capital_tier: r.capital_tier }),
      created_at: Number(r.created_at),
    })
    nodesUpserted++
  }

  const signals = await db.execute({
    sql: "SELECT id, strategy_id, instrument, direction, created_at FROM signals WHERE created_at > ?",
    args: [since],
  })
  for (const r of signals.rows) {
    const nodeId = `signals:${r.id}`
    await upsertNode({
      id: nodeId, node_type: "signal", label: `${r.direction} ${r.instrument}`,
      ref_table: "signals", ref_id: String(r.id), summary: null,
      metadata_json: null, created_at: Number(r.created_at),
    })
    nodesUpserted++
    if (r.strategy_id) {
      await upsertEdge(nodeId, `strategies:${r.strategy_id}`, "generated_by")
      edgesUpserted++
    }
    const instrument = String(r.instrument).toUpperCase()
    if (!symbolsSeen.has(instrument)) {
      await upsertNode({ id: symbolNodeId(instrument), node_type: "symbol", label: instrument, ref_table: null, ref_id: null, summary: null, metadata_json: null })
      symbolsSeen.add(instrument)
      nodesUpserted++
    }
    await upsertEdge(nodeId, symbolNodeId(instrument), "concerns")
    edgesUpserted++
  }

  const trades = await db.execute({
    sql: "SELECT id, signal_id, instrument, direction, r_multiple, opened_at FROM trades WHERE opened_at > ?",
    args: [since],
  })
  for (const r of trades.rows) {
    const nodeId = `trades:${r.id}`
    await upsertNode({
      id: nodeId, node_type: "trade", label: `${r.direction} ${r.instrument} (${r.r_multiple ?? "?"}R)`,
      ref_table: "trades", ref_id: String(r.id), summary: null,
      metadata_json: JSON.stringify({ r_multiple: r.r_multiple }),
      created_at: Number(r.opened_at),
    })
    nodesUpserted++
    if (r.signal_id) {
      await upsertEdge(nodeId, `signals:${r.signal_id}`, "filled_by")
      edgesUpserted++
    }
  }

  const proposals = await db.execute({
    sql: "SELECT id, strategy_id, hypothesis, status, created_at FROM proposals WHERE created_at > ?",
    args: [since],
  })
  for (const r of proposals.rows) {
    const nodeId = `proposals:${r.id}`
    await upsertNode({
      id: nodeId, node_type: "proposal", label: String(r.hypothesis ?? r.id).slice(0, 80),
      ref_table: "proposals", ref_id: String(r.id),
      summary: r.hypothesis ? String(r.hypothesis) : null,
      metadata_json: JSON.stringify({ status: r.status }),
      created_at: Number(r.created_at),
    })
    nodesUpserted++
    if (r.strategy_id) {
      await upsertEdge(nodeId, `strategies:${r.strategy_id}`, "proposes_change_to")
      edgesUpserted++
    }
  }

  const experiments = await db.execute({
    sql: "SELECT id, proposal_id, original_strategy_id, started_at FROM experiments WHERE started_at > ?",
    args: [since],
  }).catch(() => ({ rows: [] as Record<string, unknown>[] }))
  for (const r of experiments.rows) {
    const nodeId = `experiments:${r.id}`
    await upsertNode({
      id: nodeId, node_type: "experiment", label: `experiment ${r.id}`,
      ref_table: "experiments", ref_id: String(r.id), summary: null, metadata_json: null,
      created_at: Number(r.started_at),
    })
    nodesUpserted++
    if (r.proposal_id) {
      await upsertEdge(nodeId, `proposals:${r.proposal_id}`, "validates")
      edgesUpserted++
    }
  }

  await setLastSyncedAt(until)
  return { nodesUpserted, edgesUpserted, since, until }
}

export interface GraphData {
  nodes: KgNode[]
  edges: KgEdge[]
}

export async function getGraph(limit = 2000): Promise<GraphData> {
  await ensureTables()
  const nodes = await db.execute({ sql: "SELECT * FROM kg_nodes ORDER BY updated_at DESC LIMIT ?", args: [limit] })
  const nodeIds = new Set(nodes.rows.map(r => String(r.id)))
  const edges = await db.execute({ sql: "SELECT * FROM kg_edges ORDER BY created_at DESC LIMIT ?", args: [limit * 4] })
  return {
    nodes: nodes.rows.map(r => r as unknown as KgNode),
    edges: edges.rows
      .map(r => r as unknown as KgEdge)
      .filter(e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id)),
  }
}
