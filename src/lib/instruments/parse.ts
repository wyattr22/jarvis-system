// Instrument symbology parser (Phase 11.6).
//
// The opportunities table keeps `instrument TEXT` as the canonical value —
// structure is derived on read, never stored, so every existing row stays
// valid and the allocator/dedup/MCP keying on the bare string is untouched.
//
// Conventions handled:
//   OCC options   SPY250718C00550000  (root ≤6 + YYMMDD + C/P + strike*1000, 8 digits)
//   futures       ESU26 / ESU6 (root + FGHJKMNQUVXZ month code + 1-2 digit year)
//                 ES=F (Yahoo continuous)
//   forex         EUR/USD, EUR_USD, EURUSD  → normalized EUR/USD
//   equity        anything else that looks like a plain ticker

import type { AssetClass } from "@/lib/brokers/adapter"
import { FUTURES_CATALOG } from "./proxies"

export interface ParsedInstrument {
  raw: string
  assetClass: AssetClass
  /** Underlying/root: SPY for the option, ES for the future, EUR/USD pair */
  underlying: string
  /** Options + dated futures: ISO expiry date (options) or contract month (futures) */
  expiry?: string
  strike?: number
  right?: "C" | "P"
  multiplier?: number
  /** Futures: e.g. "U26" */
  contractMonth?: string
}

// F G H J K M N Q U V X Z = Jan..Dec
const MONTH_CODES: Record<string, number> = {
  F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12,
}

const FUTURES_ROOTS = new Map(FUTURES_CATALOG.map(f => [f.root, f]))

// OCC: root (1-6 alphanumeric, may be padded), YYMMDD, C|P, strike*1000 (8 digits)
const OCC_RE = /^([A-Z][A-Z0-9]{0,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/

// Dated futures: known root + month code + 1-2 digit year
const FUTURES_DATED_RE = /^([A-Z0-9]{1,3})([FGHJKMNQUVXZ])(\d{1,2})$/

// Forex: 6 letters or XXX/YYY or XXX_YYY with known-ish currency codes
const FX_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD",
  "SEK", "NOK", "MXN", "ZAR", "SGD", "HKD", "CNH", "BTC", "ETH",
])
const FX_SEP_RE = /^([A-Z]{3})[/_]([A-Z]{3})$/
const FX_COMPACT_RE = /^([A-Z]{3})([A-Z]{3})$/

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export function parseInstrument(raw: string, assetClassHint?: AssetClass): ParsedInstrument {
  const s = raw.trim().toUpperCase()

  // OCC option
  const occ = s.match(OCC_RE)
  if (occ && (assetClassHint === undefined || assetClassHint === "options")) {
    const [, root, yy, mm, dd, right, strikeRaw] = occ
    const year = 2000 + Number(yy)
    if (isValidDate(year, Number(mm), Number(dd))) {
      return {
        raw,
        assetClass: "options",
        underlying: root,
        expiry: `${year}-${mm}-${dd}`,
        strike: Number(strikeRaw) / 1000,
        right: right as "C" | "P",
        multiplier: 100,
      }
    }
  }

  // Yahoo continuous futures (ES=F)
  if (s.endsWith("=F")) {
    const root = s.slice(0, -2)
    const spec = FUTURES_ROOTS.get(root)
    return {
      raw,
      assetClass: "futures",
      underlying: root,
      multiplier: spec?.multiplier,
    }
  }

  // Dated futures (ESU26) — only when the root is in the catalog, otherwise
  // short tickers like "F" or "GEU1"-lookalikes would misparse.
  const fut = s.match(FUTURES_DATED_RE)
  if (fut && FUTURES_ROOTS.has(fut[1])) {
    const [, root, monthCode, yearRaw] = fut
    const month = MONTH_CODES[monthCode]
    const year = yearRaw.length === 2
      ? 2000 + Number(yearRaw)
      : 2020 + Number(yearRaw) // single-digit year: assume current decade
    const spec = FUTURES_ROOTS.get(root)!
    return {
      raw,
      assetClass: "futures",
      underlying: root,
      contractMonth: `${monthCode}${yearRaw}`,
      expiry: `${year}-${String(month).padStart(2, "0")}`,
      multiplier: spec.multiplier,
    }
  }

  // Forex
  const fxSep = s.match(FX_SEP_RE)
  if (fxSep && FX_CODES.has(fxSep[1]) && FX_CODES.has(fxSep[2])) {
    return { raw, assetClass: "forex", underlying: `${fxSep[1]}/${fxSep[2]}` }
  }
  const fxCompact = s.match(FX_COMPACT_RE)
  if (
    fxCompact && FX_CODES.has(fxCompact[1]) && FX_CODES.has(fxCompact[2]) &&
    (assetClassHint === "forex" || assetClassHint === undefined)
  ) {
    // 6-letter strings are ambiguous with tickers (GOOGLE isn't a pair) —
    // only treat as forex when both halves are known currency codes.
    return { raw, assetClass: "forex", underlying: `${fxCompact[1]}/${fxCompact[2]}` }
  }

  // Equity / crypto fallthrough — respect an explicit hint
  return {
    raw,
    assetClass: assetClassHint ?? "equity",
    underlying: s,
  }
}
