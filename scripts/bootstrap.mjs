// One-time bootstrap: apply schema, seed DB rows, sync Alpaca fills
// Run: node scripts/bootstrap.mjs

import { createClient } from "@libsql/client"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dir = dirname(fileURLToPath(import.meta.url))

const TURSO_URL = "libsql://jarvis-wyattr22.aws-us-east-1.turso.io"
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzk3ODI1OTUsImlkIjoiMDE5ZTYzNGUtOWMwMS03MTc1LTg1YTYtMTkxNmFkNDVlODhmIiwicmlkIjoiNzcwOWE0OWEtOTc1MC00MmY3LTlhN2EtMDljOGVmYTc1YjI3In0.6sYPRi2qNaTIvpglSUKdWxhswiByWIh0guXUeiyYieQxWSv3lZxy0HZa2KSsnITnAojMF6ZT5xFPGZzpSu9GAw"
const ALPACA_KEY = "PKP7YHMTTKJ6O235LBUYGTSEDV"
const ALPACA_SECRET = "a5ZTDAMpbdmGTHXRTKEirvkKpX2XHqWywbS3d94tYx4"
const ALPACA_BASE = "https://paper-api.alpaca.markets"

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })

const alpacaHeaders = {
  "APCA-API-KEY-ID": ALPACA_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET,
}

// ── SCHEMA ────────────────────────────────────────────────────────────────────

async function applySchema() {
  console.log("\n=== SCHEMA ===")
  const schemaPath = join(__dir, "../src/lib/db/schema.sql")
  const sql = readFileSync(schemaPath, "utf8")
  const stmts = sql
    .split("\n")
    .filter(line => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 0)

  let ok = 0, fail = 0
  for (const stmt of stmts) {
    try {
      await db.execute(stmt)
      ok++
    } catch (e) {
      console.log(`  SKIP: ${stmt.slice(0, 60)} — ${e.message}`)
      fail++
    }
  }
  console.log(`  ${ok} statements applied, ${fail} skipped`)
}

// ── SEED ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log("\n=== SEED ===")
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 86400000
  const created = []

  // Strategy
  const ex = await db.execute({ sql: "SELECT id FROM strategies WHERE id = ?", args: ["smc-ict-v4"] })
  if (ex.rows.length === 0) {
    await db.execute({
      sql: `INSERT INTO strategies (id, name, description, enabled, capital_tier, weight, created_at)
            VALUES (?, ?, ?, 1, 1, 1.0, ?)`,
      args: [
        "smc-ict-v4",
        "SMC/ICT v4",
        "Smart Money Concepts / ICT methodology (bot.py v22). 4 kill zones. 12 symbols: RIOT MARA HUT RCAT IONQ TSLA UVXY HOOD SNAP ALAB AAOI CRDO.",
        now,
      ],
    })
    created.push("strategy: smc-ict-v4")
  } else {
    console.log("  strategy: already exists")
  }

  // Holdout config
  const hc = await db.execute({ sql: "SELECT id FROM holdout_config WHERE id = 1", args: [] })
  if (hc.rows.length === 0) {
    await db.execute({
      sql: "INSERT INTO holdout_config (id, boundary_timestamp, updated_at) VALUES (1, ?, ?)",
      args: [thirtyDaysAgo, now],
    })
    created.push("holdout_config")
  } else {
    console.log("  holdout_config: already exists")
  }

  // Agent rows
  const agentSeeds = [
    { id: "observer-ml", name: "Observer", role: "observer", model_provider: "internal", model_id: "random-forest", model_family: "ml" },
    { id: "researcher-groq", name: "Researcher", role: "researcher", model_provider: "groq", model_id: "llama-3.3-70b-versatile", model_family: "llama" },
    { id: "critic-a-groq", name: "Critic A", role: "critic", model_provider: "groq", model_id: "llama-3.1-8b-instant", model_family: "llama" },
    { id: "critic-b-cerebras", name: "Critic B", role: "critic", model_provider: "cerebras", model_id: "llama3.1-8b", model_family: "cerebras" },
    { id: "critic-c-openrouter", name: "Critic C", role: "critic", model_provider: "openrouter", model_id: "deepseek/deepseek-r1:free", model_family: "deepseek" },
    { id: "risk-manager-groq", name: "Risk Manager", role: "risk_manager", model_provider: "groq", model_id: "llama-3.3-70b-versatile", model_family: "llama" },
    { id: "meta-agent-groq", name: "Meta-Agent", role: "meta_agent", model_provider: "groq", model_id: "llama-3.3-70b-versatile", model_family: "llama" },
  ]

  for (const a of agentSeeds) {
    const ae = await db.execute({ sql: "SELECT id FROM agents WHERE id = ?", args: [a.id] })
    if (ae.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO agents (id, name, role, model_provider, model_id, model_family, status, spawned_at, spawned_by)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 'seed')`,
        args: [a.id, a.name, a.role, a.model_provider, a.model_id, a.model_family, now],
      })
      created.push(`agent: ${a.id}`)
    }
  }

  if (created.length) {
    console.log("  Created:", created.join(", "))
  } else {
    console.log("  All rows already exist — nothing to do")
  }
}

// ── FILLS SYNC ────────────────────────────────────────────────────────────────

async function syncFills() {
  console.log("\n=== SYNC FILLS ===")
  const synced = []
  const errors = []

  // Phase 1: import filled orders
  const after = new Date(Date.now() - 48 * 3600000).toISOString()
  const ordersRes = await fetch(
    `${ALPACA_BASE}/v2/orders?status=filled&limit=100&after=${after}&direction=desc`,
    { headers: alpacaHeaders, signal: AbortSignal.timeout(10000) }
  )
  if (!ordersRes.ok) {
    console.log(`  Alpaca orders error: ${ordersRes.status} ${await ordersRes.text()}`)
    return
  }
  const orders = await ordersRes.json()
  console.log(`  Fetched ${orders.length} filled orders from Alpaca`)

  for (const order of orders) {
    if (!order.filled_at) continue
    const filledAt = new Date(order.filled_at).getTime()

    const existing = await db.execute({ sql: "SELECT id FROM trades WHERE id = ?", args: [`trd-${order.id}`] })
    if (existing.rows.length > 0) continue

    const direction = order.side === "buy" ? "long" : "short"
    const signal = await db.execute({
      sql: `SELECT id, stop FROM signals
            WHERE instrument = ? AND direction = ? AND status IN ('pending','filled')
              AND created_at BETWEEN ? AND ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [order.symbol, direction, filledAt - 3600000, filledAt + 60000],
    })

    const signalId = signal.rows.length > 0 ? String(signal.rows[0].id) : null
    const stop = signal.rows.length > 0 ? Number(signal.rows[0].stop) : null
    const fillPrice = parseFloat(order.filled_avg_price ?? order.limit_price ?? "0")
    const qty = parseFloat(order.filled_qty ?? order.qty ?? "1")

    const isBracketParent = order.order_class === "bracket" && !order.legs
    const isMarket = !order.order_class && order.type === "market"

    if (isBracketParent || isMarket) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO trades
                (id, signal_id, broker, instrument, direction, size, fill_price, opened_at)
              VALUES (?, ?, 'alpaca', ?, ?, ?, ?, ?)`,
        args: [`trd-${order.id}`, signalId, order.symbol, direction, qty, fillPrice, filledAt],
      })
      if (signalId) {
        await db.execute({ sql: "UPDATE signals SET status='filled' WHERE id=?", args: [signalId] })
      }
      synced.push(`OPEN: ${order.symbol} ${direction} @ ${fillPrice}`)
    } else if (order.legs?.length) {
      const parentOrderId = order.legs[0]?.id ?? order.id
      const entryTrade = await db.execute({
        sql: "SELECT id, fill_price, size FROM trades WHERE id=? OR signal_id IN (SELECT id FROM signals WHERE instrument=? AND created_at > ?)",
        args: [`trd-${parentOrderId}`, order.symbol, filledAt - 7200000],
      })
      if (entryTrade.rows.length > 0) {
        const entry = Number(entryTrade.rows[0].fill_price)
        const exit = fillPrice
        const size = Number(entryTrade.rows[0].size)
        const pnl = direction === "long" ? (exit - entry) * size : (entry - exit) * size
        const rMultiple = stop ? (direction === "long" ? (exit - entry) / (entry - stop) : (entry - exit) / (stop - entry)) : null
        await db.execute({
          sql: "UPDATE trades SET exit_price=?, pnl=?, r_multiple=?, closed_at=? WHERE id=?",
          args: [exit, pnl, rMultiple, filledAt, String(entryTrade.rows[0].id)],
        })
        synced.push(`CLOSE: ${order.symbol} R=${rMultiple?.toFixed(2) ?? "?"}`)
      }
    }
  }

  // Phase 2: reconcile open trades against current positions
  const openTrades = await db.execute({
    sql: "SELECT id, instrument, direction, fill_price, size, signal_id FROM trades WHERE exit_price IS NULL AND opened_at > ?",
    args: [Date.now() - 7 * 86400000],
  })
  console.log(`  Open trades in DB: ${openTrades.rows.length}`)

  const posRes = await fetch(`${ALPACA_BASE}/v2/positions`, {
    headers: alpacaHeaders,
    signal: AbortSignal.timeout(8000),
  })
  const openSymbols = new Set()
  if (posRes.ok) {
    const positions = await posRes.json()
    for (const p of positions) openSymbols.add(p.symbol)
    console.log(`  Current Alpaca positions: ${positions.length} (${[...openSymbols].join(", ") || "none"})`)
  }

  for (const trade of openTrades.rows) {
    if (!openSymbols.has(String(trade.instrument))) {
      const closedOrders = await fetch(
        `${ALPACA_BASE}/v2/orders?status=filled&symbols=${trade.instrument}&limit=10&after=${new Date(Number(trade.opened_at ?? Date.now()) - 86400000).toISOString()}`,
        { headers: alpacaHeaders, signal: AbortSignal.timeout(8000) }
      )
      if (closedOrders.ok) {
        const cls = await closedOrders.json()
        const exitOrder = cls.find(o =>
          o.symbol === trade.instrument &&
          o.side !== (trade.direction === "long" ? "buy" : "sell") &&
          o.filled_at
        )
        if (exitOrder?.filled_avg_price) {
          const entry = Number(trade.fill_price)
          const exit = parseFloat(exitOrder.filled_avg_price)
          const size = Number(trade.size)
          const stopRow = trade.signal_id
            ? (await db.execute({ sql: "SELECT stop FROM signals WHERE id=?", args: [trade.signal_id] })).rows[0]
            : null
          const stop = stopRow ? Number(stopRow.stop) : null
          const dir = String(trade.direction)
          const pnl = dir === "long" ? (exit - entry) * size : (entry - exit) * size
          const rMultiple = stop ? (dir === "long" ? (exit - entry) / (entry - stop) : (entry - exit) / (stop - entry)) : null
          await db.execute({
            sql: "UPDATE trades SET exit_price=?, pnl=?, r_multiple=?, closed_at=? WHERE id=?",
            args: [exit, pnl, rMultiple, new Date(exitOrder.filled_at).getTime(), trade.id],
          })
          synced.push(`RECONCILE: ${trade.instrument} R=${rMultiple?.toFixed(2) ?? "?"}`)
        }
      }
    }
  }

  if (synced.length) {
    console.log("  Synced:", synced.join(" | "))
  } else {
    console.log("  Nothing new to sync")
  }
  if (errors.length) console.log("  Errors:", errors.join(", "))
}

// ── VERIFY ────────────────────────────────────────────────────────────────────

async function verify() {
  console.log("\n=== VERIFY ===")
  const [strats, hc, agents, trades, signals] = await Promise.all([
    db.execute("SELECT id, name FROM strategies"),
    db.execute("SELECT id, boundary_timestamp FROM holdout_config"),
    db.execute("SELECT id, role FROM agents"),
    db.execute("SELECT COUNT(*) as n FROM trades"),
    db.execute("SELECT COUNT(*) as n FROM signals"),
  ])
  console.log(`  Strategies: ${strats.rows.map(r => r.id).join(", ")}`)
  console.log(`  Holdout config: ${hc.rows.length ? "✓ boundary=" + new Date(Number(hc.rows[0].boundary_timestamp)).toLocaleDateString() : "MISSING"}`)
  console.log(`  Agents: ${agents.rows.map(r => `${r.id}(${r.role})`).join(", ")}`)
  console.log(`  Trades in DB: ${trades.rows[0].n}`)
  console.log(`  Signals in DB: ${signals.rows[0].n}`)
}

// ── RUN ───────────────────────────────────────────────────────────────────────

try {
  await applySchema()
  await seed()
  await syncFills()
  await verify()
  console.log("\nDone.")
} catch (e) {
  console.error("Fatal:", e)
  process.exit(1)
} finally {
  db.close()
}
