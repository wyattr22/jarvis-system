// OandaAdapter — forex broker adapter (Phase 15) against OANDA's v20 REST
// practice API (`api-fxpractice.oanda.com`), matching the "zero credit card"
// constraint already used to pick every other free-tier provider in this repo.
//
// Symbol convention: the rest of Jarvis speaks forex pairs as "EUR/USD"
// (see src/lib/instruments/parse.ts). OANDA's wire format is "EUR_USD".
// Conversion happens at the edges of this file only — nothing upstream needs
// to know about OANDA's underscore convention.

import { safeFetch } from "@/lib/sandbox/whitelist"
import type {
  BrokerAdapter, UnifiedOrder, OrderResult, Quote, Bar, Position, AccountSnapshot,
} from "./adapter"

const OANDA_BASE = "https://api-fxpractice.oanda.com"

function accountId(): string {
  return process.env.OANDA_ACCOUNT_ID ?? ""
}

function headers() {
  return {
    "Authorization": `Bearer ${process.env.OANDA_API_KEY ?? ""}`,
    "Content-Type": "application/json",
  }
}

/** "EUR/USD" | "EURUSD" | "eur_usd" → "EUR_USD" (OANDA wire format). */
export function toOandaInstrument(symbol: string): string {
  const s = symbol.trim().toUpperCase()
  if (s.includes("_")) return s
  if (s.includes("/")) return s.replace("/", "_")
  if (s.length === 6) return `${s.slice(0, 3)}_${s.slice(3)}`
  return s
}

/** "EUR_USD" → "EUR/USD" (Jarvis's canonical forex format). */
export function fromOandaInstrument(instrument: string): string {
  return instrument.replace("_", "/")
}

const GRANULARITY_MAP: Record<string, string> = {
  "1Min": "M1", "5Min": "M5", "15Min": "M15", "30Min": "M30",
  "1Hour": "H1", "4Hour": "H4", "1Day": "D",
}

export function toOandaGranularity(timeframe: string): string {
  return GRANULARITY_MAP[timeframe] ?? "M15"
}

export const OandaAdapter: BrokerAdapter = {
  id: "oanda",
  assetClass: "forex",
  displayName: "OANDA (forex, practice)",

  async quote(symbol: string): Promise<Quote> {
    const instrument = toOandaInstrument(symbol)
    const r = await safeFetch(
      `${OANDA_BASE}/v3/accounts/${accountId()}/pricing?instruments=${instrument}`,
      { headers: headers(), signal: AbortSignal.timeout(6000) },
    )
    if (!r.ok) throw new Error(`oanda pricing ${r.status}: ${await r.text().catch(() => "")}`)
    const data = await r.json()
    const p = data.prices?.[0]
    if (!p) throw new Error(`oanda: no price for ${instrument}`)
    const bid = Number(p.closeoutBid ?? p.bids?.[0]?.price)
    const ask = Number(p.closeoutAsk ?? p.asks?.[0]?.price)
    return {
      symbol: fromOandaInstrument(p.instrument ?? instrument),
      bid, ask,
      mid: (bid + ask) / 2,
      timestamp: p.time ?? new Date().toISOString(),
    }
  },

  async bars(symbol: string, timeframe: string, limit: number): Promise<Bar[]> {
    const instrument = toOandaInstrument(symbol)
    const granularity = toOandaGranularity(timeframe)
    const r = await safeFetch(
      `${OANDA_BASE}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${limit}&price=M`,
      { headers: headers(), signal: AbortSignal.timeout(8000) },
    )
    if (!r.ok) throw new Error(`oanda candles ${r.status}: ${await r.text().catch(() => "")}`)
    const data = await r.json()
    const candles = Array.isArray(data.candles) ? data.candles : []
    return candles
      .filter((c: Record<string, unknown>) => c.complete !== false)
      .map((c: Record<string, unknown>) => {
        const mid = c.mid as Record<string, string>
        return {
          t: String(c.time),
          o: Number(mid.o), h: Number(mid.h), l: Number(mid.l), c: Number(mid.c),
          v: Number(c.volume ?? 0),
        }
      })
  },

  async place(order: UnifiedOrder): Promise<OrderResult> {
    const instrument = toOandaInstrument(order.symbol)
    // OANDA expresses direction as signed units, not side + qty.
    const units = order.side === "buy" ? order.qty : -order.qty
    const body: Record<string, unknown> = {
      order: {
        type: order.type === "limit" ? "LIMIT" : "MARKET",
        instrument,
        units: String(units),
        timeInForce: order.type === "limit" ? "GTC" : "FOK",
        positionFill: "DEFAULT",
        ...(order.type === "limit" && order.limit_price !== undefined
          ? { price: String(order.limit_price) } : {}),
        // OANDA's own bracket mechanism — mirrors the "exit management lives
        // at the broker" principle already used for AlpacaAdapter (14.2).
        ...(order.stop_price !== undefined
          ? { stopLossOnFill: { price: String(order.stop_price) } } : {}),
        ...(order.take_profit !== undefined
          ? { takeProfitOnFill: { price: String(order.take_profit) } } : {}),
        ...(order.client_order_id ? { clientExtensions: { id: order.client_order_id } } : {}),
      },
    }
    const r = await safeFetch(`${OANDA_BASE}/v3/accounts/${accountId()}/orders`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || data.orderRejectTransaction) {
      const reason = data.orderRejectTransaction?.rejectReason ?? data.errorMessage ?? `${r.status}`
      return { ok: false, broker: "oanda", error: String(reason) }
    }
    const fillTxn = data.orderFillTransaction ?? data.orderCreateTransaction
    return {
      ok: true,
      broker: "oanda",
      order_id: fillTxn?.id ?? data.lastTransactionID,
      status: fillTxn ? "filled" : "pending",
    }
  },

  async positions(): Promise<Position[]> {
    const r = await safeFetch(`${OANDA_BASE}/v3/accounts/${accountId()}/openTrades`, {
      headers: headers(), signal: AbortSignal.timeout(6000),
    })
    if (!r.ok) return []
    const data = await r.json()
    const trades = Array.isArray(data.trades) ? data.trades : []
    return trades.map((t: Record<string, unknown>) => {
      const units = Number(t.currentUnits)
      return {
        symbol: fromOandaInstrument(String(t.instrument)),
        qty: Math.abs(units),
        avg_entry_price: Number(t.price),
        unrealized_pl: Number(t.unrealizedPL ?? 0),
        side: (units >= 0 ? "long" : "short") as "long" | "short",
      }
    })
  },

  async account(): Promise<AccountSnapshot> {
    const r = await safeFetch(`${OANDA_BASE}/v3/accounts/${accountId()}/summary`, {
      headers: headers(), signal: AbortSignal.timeout(6000),
    })
    if (!r.ok) throw new Error(`oanda account ${r.status}: ${await r.text().catch(() => "")}`)
    const data = await r.json()
    const a = data.account
    return {
      broker: "oanda",
      equity: Number(a.NAV ?? a.balance),
      cash: Number(a.balance),
      buying_power: Number(a.marginAvailable ?? a.balance),
      day_pnl: Number(a.unrealizedPL ?? 0),
      currency: String(a.currency ?? "USD"),
      // PDT rules don't apply to forex — the existing PDT guard in
      // auto-cycle.ts is gated on the equity adapter's own count, not this.
      daytrade_count: 0,
    }
  },

  async isOpen(): Promise<boolean> {
    // Forex trades ~24/5: opens Sun 22:00 UTC, closes Fri 22:00 UTC.
    const now = new Date()
    const day = now.getUTCDay() // 0=Sun .. 6=Sat
    const hour = now.getUTCHours()
    if (day === 6) return false // Saturday: always closed
    if (day === 0 && hour < 22) return false // Sunday before 22:00 UTC
    if (day === 5 && hour >= 22) return false // Friday after 22:00 UTC
    return true
  },
}
