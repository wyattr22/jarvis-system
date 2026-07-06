// Quote freshness metadata — the honesty contract for Phase 11.
// Every price surfaced in the product carries { source, asOf, delaySeconds,
// realtime } so the UI can badge it LIVE / DELAYED / EOD instead of implying
// everything is real-time.

export type Freshness = "realtime" | "delayed" | "eod"

export interface QuoteMeta {
  /** Provider identifier, e.g. "alpaca.iex", "yahoo.futures" */
  source: string
  /** ISO timestamp of the underlying trade/quote */
  asOf: string
  /** Nominal feed delay in seconds (0 = real-time feed) */
  delaySeconds: number
  /** True only for genuinely real-time feeds */
  realtime: boolean
}

export interface MarketQuote {
  symbol: string
  price: number
  changePct: number | null
  bid?: number
  ask?: number
  meta: QuoteMeta
}

// Nominal delay per source. Note: alpaca.iex is real-time but covers only
// ~2-3% of consolidated volume — quotes on thin small caps can lag the NBBO.
export const SOURCE_DELAYS: Record<string, { delaySeconds: number; realtime: boolean }> = {
  "alpaca.iex": { delaySeconds: 0, realtime: true },
  "alpaca.options": { delaySeconds: 900, realtime: false }, // indicative OPRA derivative
  "finnhub.quote": { delaySeconds: 0, realtime: true },
  "finnhub.forex": { delaySeconds: 0, realtime: true },
  "yahoo.futures": { delaySeconds: 900, realtime: false }, // no free real-time CME data exists
  "yahoo.index": { delaySeconds: 900, realtime: false },
  // Yahoo FX prints are near-live but unofficial with no SLA — labeled
  // delayed until the Finnhub provider (11.3) takes over as forex primary.
  "yahoo.forex": { delaySeconds: 900, realtime: false },
  "alphavantage.daily": { delaySeconds: 86400, realtime: false },
}

export function metaFor(source: string, asOf: string): QuoteMeta {
  const spec = SOURCE_DELAYS[source] ?? { delaySeconds: 900, realtime: false }
  return { source, asOf, ...spec }
}

const REALTIME_MAX_AGE_MS = 60_000
const EOD_THRESHOLD_MS = 24 * 60 * 60 * 1000

/**
 * Classify freshness from actual timestamp age, not just the nominal source
 * delay — a "realtime" source serving a 10-minute-old print must render as
 * delayed. `now` is injectable for tests.
 *
 * Note: outside market hours even live feeds serve old prints, so quotes
 * naturally degrade to "delayed"/"eod" badges over a weekend — that is the
 * honest rendering, not a bug.
 */
export function freshnessOf(meta: QuoteMeta, now: number = Date.now()): Freshness {
  const asOfMs = Date.parse(meta.asOf)
  if (Number.isNaN(asOfMs)) return "eod"
  const age = now - asOfMs
  if (age >= EOD_THRESHOLD_MS) return "eod"
  if (meta.realtime && meta.delaySeconds === 0 && age < REALTIME_MAX_AGE_MS) return "realtime"
  return "delayed"
}
