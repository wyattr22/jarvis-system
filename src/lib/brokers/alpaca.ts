// AlpacaAdapter — wraps the existing src/lib/data/alpaca.ts + /api/trade
// pipeline behind the BrokerAdapter interface.
//
// Asset class: equity (US stocks). Crypto could be added as a separate
// AlpacaCryptoAdapter later — Alpaca treats them differently enough that
// one class per adapter is cleaner than overloading.

import {
  getBars as rawGetBars,
  getLatestQuote as rawGetLatestQuote,
  getAccount as rawGetAccount,
  getPositions as rawGetPositions,
} from "@/lib/data/alpaca"
import { safeFetch } from "@/lib/sandbox/whitelist"
import type {
  BrokerAdapter, UnifiedOrder, OrderResult, Quote, Bar, Position, AccountSnapshot,
} from "./adapter"

const ALPACA_BASE = process.env.ALPACA_PAPER === "true"
  ? "https://paper-api.alpaca.markets"
  : "https://api.alpaca.markets"

function headers() {
  return {
    "APCA-API-KEY-ID":     process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
    "Content-Type":        "application/json",
  }
}

export const AlpacaAdapter: BrokerAdapter = {
  id: "alpaca",
  assetClass: "equity",
  displayName: "Alpaca (US equity, paper)",

  async quote(symbol) {
    const q = await rawGetLatestQuote(symbol)
    const out: Quote = {
      symbol: q.symbol,
      bid:    q.bid,
      ask:    q.ask,
      mid:    q.mid,
      timestamp: q.timestamp,
    }
    return out
  },

  async bars(symbol, timeframe, limit) {
    const raw = await rawGetBars(symbol, timeframe, limit)
    const out: Bar[] = raw.map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
    return out
  },

  async place(order: UnifiedOrder): Promise<OrderResult> {
    const body: Record<string, unknown> = {
      symbol:        order.symbol,
      qty:           order.qty,
      side:          order.side,
      type:          order.type,
      time_in_force: order.time_in_force ?? "day",
    }
    if (order.type === "limit" && order.limit_price !== undefined) {
      body.limit_price = order.limit_price
    }
    // Bracket order: include both stop and target via Alpaca's order_class=bracket
    if (order.stop_price !== undefined || order.take_profit !== undefined) {
      body.order_class = "bracket"
      if (order.stop_price !== undefined) {
        body.stop_loss = { stop_price: order.stop_price }
      }
      if (order.take_profit !== undefined) {
        body.take_profit = { limit_price: order.take_profit }
      }
    }
    if (order.client_order_id) body.client_order_id = order.client_order_id

    const r = await safeFetch(`${ALPACA_BASE}/v2/orders`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) {
      return { ok: false, broker: "alpaca", error: `${r.status}: ${await r.text().catch(() => "")}` }
    }
    const data = await r.json()
    return { ok: true, broker: "alpaca", order_id: data.id, status: data.status }
  },

  async positions(): Promise<Position[]> {
    const raw = await rawGetPositions()
    return (Array.isArray(raw) ? raw : []).map((p: Record<string, unknown>) => ({
      symbol: String(p.symbol),
      qty: Number(p.qty),
      avg_entry_price: Number(p.avg_entry_price),
      unrealized_pl: Number(p.unrealized_pl),
      side: (Number(p.qty) >= 0 ? "long" : "short") as "long" | "short",
    }))
  },

  async account(): Promise<AccountSnapshot> {
    const a = await rawGetAccount()
    return {
      broker: "alpaca",
      equity:        Number(a.equity),
      cash:          Number(a.cash),
      buying_power:  Number(a.buying_power),
      day_pnl:       Number(a.equity) - Number(a.last_equity),
      currency:      String(a.currency ?? "USD"),
      daytrade_count: Number(a.daytrade_count ?? 0),
    }
  },

  async isOpen(): Promise<boolean> {
    try {
      const r = await safeFetch(`${ALPACA_BASE}/v2/clock`, {
        headers: headers(),
        signal: AbortSignal.timeout(4000),
      })
      if (!r.ok) return false
      const data = await r.json()
      return Boolean(data.is_open)
    } catch {
      return false
    }
  },
}
