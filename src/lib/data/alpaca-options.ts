// Alpaca options chain via the free-tier feeds (probed 2026-07-05):
//   - Trading API /v2/options/contracts  -> strikes, expiries, OPEN INTEREST
//   - Data API /v1beta1/options/snapshots?feed=indicative -> quotes (15-min
//     delayed OPRA derivative); greeks/IV appear only intermittently, so GEX
//     falls back to local Black-Scholes with a default IV (options-math.ts).
//
// OCC symbols (e.g. SPY260713C00740000) are the canonical options instrument
// strings across the system.

import { safeFetch } from "@/lib/sandbox/whitelist"
import type { OptionContract } from "./options-math"

const DATA_BASE = "https://data.alpaca.markets/v1beta1"
const TRADE_BASE = process.env.ALPACA_PAPER === "true"
  ? "https://paper-api.alpaca.markets"
  : "https://api.alpaca.markets"

function headers() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  }
}

interface RawContract {
  symbol: string
  type: "call" | "put"
  strike_price: string
  expiration_date: string
  open_interest: string | number | null
}

export interface AlpacaChain {
  contracts: OptionContract[]
  /** ISO date of the expiry the chain was built from */
  expiry: string
  /** Latest quote timestamp seen across the chain's snapshots */
  asOf: string
}

// Nearest Friday at least 5 days out — a liquid weekly expiry with real OI,
// mirroring the ~1-week positioning window the Yahoo path sampled.
export function targetExpiryWindow(now: Date = new Date()): { gte: string; lte: string } {
  const start = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
  const end = new Date(now.getTime() + 12 * 24 * 60 * 60 * 1000)
  return { gte: start.toISOString().split("T")[0], lte: end.toISOString().split("T")[0] }
}

async function fetchContracts(underlying: string, spot: number): Promise<RawContract[]> {
  const { gte, lte } = targetExpiryWindow()
  // ±15% strike band around spot keeps the response to one page of the
  // strikes that actually carry OI, instead of paginating the whole board.
  const lo = Math.floor(spot * 0.85)
  const hi = Math.ceil(spot * 1.15)
  const url = `${TRADE_BASE}/v2/options/contracts?underlying_symbols=${underlying}` +
    `&expiration_date_gte=${gte}&expiration_date_lte=${lte}` +
    `&strike_price_gte=${lo}&strike_price_lte=${hi}&limit=500`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Alpaca contracts error: ${res.status}`)
  const json = await res.json()
  return json.option_contracts ?? []
}

async function fetchSnapshotIVs(underlying: string): Promise<Map<string, { iv?: number; t?: string }>> {
  const url = `${DATA_BASE}/options/snapshots/${underlying}?feed=indicative&limit=1000`
  const res = await safeFetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) })
  const out = new Map<string, { iv?: number; t?: string }>()
  if (!res.ok) return out // snapshots are enrichment, not required
  const json = await res.json()
  const snaps = json.snapshots ?? {}
  for (const [occ, snap] of Object.entries<Record<string, unknown>>(snaps)) {
    const s = snap as { impliedVolatility?: number; latestQuote?: { t?: string } }
    out.set(occ, { iv: s.impliedVolatility, t: s.latestQuote?.t })
  }
  return out
}

/**
 * Build a normalized chain for one liquid near-term expiry.
 * Returns null when the underlying has no options or the API fails —
 * callers fall back to the Yahoo scrape.
 */
export async function getAlpacaChain(underlying: string, spot: number): Promise<AlpacaChain | null> {
  try {
    const raw = await fetchContracts(underlying, spot)
    if (!raw.length) return null

    // Single expiry: the one with the most total OI in the window.
    const oiByExpiry = new Map<string, number>()
    for (const c of raw) {
      const oi = Number(c.open_interest ?? 0)
      oiByExpiry.set(c.expiration_date, (oiByExpiry.get(c.expiration_date) ?? 0) + oi)
    }
    const expiry = [...oiByExpiry.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!expiry) return null

    const ivs = await fetchSnapshotIVs(underlying)
    let asOf = ""
    const contracts: OptionContract[] = raw
      .filter(c => c.expiration_date === expiry)
      .map(c => {
        const snap = ivs.get(c.symbol)
        if (snap?.t && snap.t > asOf) asOf = snap.t
        return {
          strike: Number(c.strike_price),
          right: c.type === "call" ? "C" as const : "P" as const,
          openInterest: Number(c.open_interest ?? 0),
          impliedVolatility: snap?.iv,
        }
      })
      .filter(c => c.openInterest > 0)

    if (!contracts.length) return null
    return { contracts, expiry, asOf: asOf || new Date().toISOString() }
  } catch {
    return null
  }
}
