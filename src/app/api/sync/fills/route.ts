import { db } from "@/lib/db/client"
import { safeFetch } from "@/lib/sandbox/whitelist"

const TRADE_BASE = process.env.ALPACA_PAPER === "true"
  ? "https://paper-api.alpaca.markets"
  : "https://api.alpaca.markets"

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  }
}

function checkAuth(req: Request): boolean {
  return req.headers.get("x-vercel-cron") === "1" ||
    req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const synced: string[] = []
  const errors: string[] = []

  try {
    // ── Phase 1: Import filled orders as open trades ──────────────────────
    const after = new Date(Date.now() - 48 * 3600000).toISOString()
    const ordersRes = await safeFetch(
      `${TRADE_BASE}/v2/orders?status=filled&limit=100&after=${after}&direction=desc`,
      { headers: alpacaHeaders(), signal: AbortSignal.timeout(10000) }
    )
    if (!ordersRes.ok) throw new Error(`Alpaca orders ${ordersRes.status}`)
    const orders: AlpacaOrder[] = await ordersRes.json()

    for (const order of orders) {
      if (!order.filled_at) continue
      const filledAt = new Date(order.filled_at).getTime()

      // Skip if we already have a trade for this order
      const existing = await db.execute({
        sql: "SELECT id FROM trades WHERE id = ?",
        args: [`trd-${order.id}`],
      })
      if (existing.rows.length > 0) continue

      // Find matching signal: same instrument, same direction, created within 60 min before fill
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

      // Determine if this is a bracket parent (entry) or leg (exit)
      const isBracketParent = order.order_class === "bracket" && !order.legs
      const isBracketLeg = !!order.legs?.length

      if (isBracketParent || (!order.order_class && order.type === "market")) {
        // This is an entry order — create open trade row
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
      } else if (isBracketLeg) {
        // Exit leg — update the parent trade
        const parentOrderId = order.legs?.[0]?.id ?? order.id
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

    // ── Phase 2: Close open trades whose positions no longer exist in Alpaca ─
    const openTrades = await db.execute({
      sql: "SELECT id, instrument, direction, fill_price, size, signal_id FROM trades WHERE exit_price IS NULL AND opened_at > ?",
      args: [Date.now() - 7 * 86400000],
    })

    const posRes = await safeFetch(`${TRADE_BASE}/v2/positions`, {
      headers: alpacaHeaders(),
      signal: AbortSignal.timeout(8000),
    })
    const openSymbols = new Set<string>()
    if (posRes.ok) {
      const positions: { symbol: string }[] = await posRes.json()
      for (const p of positions) openSymbols.add(p.symbol)
    }

    for (const trade of openTrades.rows) {
      if (!openSymbols.has(String(trade.instrument))) {
        // Position closed — fetch its final fills from recent closed orders
        const closedOrders = await safeFetch(
          `${TRADE_BASE}/v2/orders?status=filled&symbols=${trade.instrument}&limit=10&after=${new Date(Number(openTrades.rows[0]) - 86400000).toISOString()}`,
          { headers: alpacaHeaders(), signal: AbortSignal.timeout(8000) }
        )
        if (closedOrders.ok) {
          const cls: AlpacaOrder[] = await closedOrders.json()
          const exitOrder = cls.find(o =>
            o.symbol === trade.instrument &&
            o.side !== (trade.direction === "long" ? "buy" : "sell") &&
            o.filled_at
          )
          if (exitOrder && exitOrder.filled_avg_price) {
            const entry = Number(trade.fill_price)
            const exit = parseFloat(exitOrder.filled_avg_price)
            const size = Number(trade.size)
            const stop = trade.signal_id
              ? Number((await db.execute({ sql: "SELECT stop FROM signals WHERE id=?", args: [trade.signal_id] })).rows[0]?.stop)
              : null
            const direction = String(trade.direction)
            const pnl = direction === "long" ? (exit - entry) * size : (entry - exit) * size
            const rMultiple = stop ? (direction === "long" ? (exit - entry) / (entry - stop) : (entry - exit) / (stop - entry)) : null
            await db.execute({
              sql: "UPDATE trades SET exit_price=?, pnl=?, r_multiple=?, closed_at=? WHERE id=?",
              args: [exit, pnl, rMultiple, new Date(exitOrder.filled_at!).getTime(), trade.id],
            })
            synced.push(`RECONCILE CLOSE: ${trade.instrument} R=${rMultiple?.toFixed(2) ?? "?"}`)
          }
        }
      }
    }
  } catch (err) {
    errors.push(String(err))
  }

  return Response.json({ ok: true, synced, errors, syncedAt: new Date().toISOString() })
}

interface AlpacaOrder {
  id: string
  symbol: string
  side: "buy" | "sell"
  type: string
  order_class: string
  status: string
  filled_qty: string | null
  qty: string
  filled_avg_price: string | null
  limit_price: string | null
  filled_at: string | null
  legs?: AlpacaOrder[]
}
