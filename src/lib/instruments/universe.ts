// Cross-asset symbol universe for search/typeahead (11.8).
//   - US equities: Alpaca /v2/assets (full active universe, cached 24h in Redis)
//   - futures/forex/indexes: static catalogs
// rankSymbolMatches is pure and unit-tested.

import { safeFetch } from "@/lib/sandbox/whitelist"
import { redis } from "@/lib/cache/redis"
import { FUTURES_CATALOG } from "./proxies"
import { INDEX_CATALOG } from "@/lib/data/indexes"

export interface UniverseEntry {
  symbol: string
  name: string
  assetClass: "equity" | "futures" | "forex" | "index"
}

const FOREX_MAJORS = [
  "EUR/USD", "USD/JPY", "GBP/USD", "USD/CHF", "AUD/USD", "USD/CAD", "NZD/USD", "EUR/GBP",
]

export function catalogEntries(): UniverseEntry[] {
  return [
    ...FUTURES_CATALOG.map(f => ({
      symbol: f.future,
      name: `${f.label} (futures)`,
      assetClass: "futures" as const,
    })),
    ...FOREX_MAJORS.map(p => ({ symbol: p, name: `${p} (forex)`, assetClass: "forex" as const })),
    ...INDEX_CATALOG.map(i => ({ symbol: i.symbol, name: `${i.label} (index)`, assetClass: "index" as const })),
  ]
}

const TRADE_BASE = process.env.ALPACA_PAPER === "true"
  ? "https://paper-api.alpaca.markets"
  : "https://api.alpaca.markets"

const UNIVERSE_KEY = "universe:us_equity:v1"
const UNIVERSE_TTL = 24 * 60 * 60

type CompactAsset = [symbol: string, name: string]

export async function getEquityUniverse(): Promise<CompactAsset[]> {
  try {
    const cached = await redis.get<CompactAsset[]>(UNIVERSE_KEY)
    if (cached) return cached
  } catch { /* fall through to fetch */ }

  const res = await safeFetch(
    `${TRADE_BASE}/v2/assets?status=active&asset_class=us_equity&attributes=`,
    {
      headers: {
        "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
        "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!res.ok) throw new Error(`Alpaca assets error: ${res.status}`)
  const assets: { symbol: string; name: string; tradable: boolean }[] = await res.json()
  const compact: CompactAsset[] = assets
    .filter(a => a.tradable)
    .map(a => [a.symbol, a.name ?? ""])

  try {
    await redis.setex(UNIVERSE_KEY, UNIVERSE_TTL, compact as unknown as string)
  } catch { /* cache write is best-effort */ }
  return compact
}

/** Pure ranking: exact symbol > symbol prefix > name substring. */
export function rankSymbolMatches(
  query: string,
  equities: CompactAsset[],
  catalog: UniverseEntry[],
  limit = 20,
): UniverseEntry[] {
  const q = query.trim().toUpperCase()
  if (!q) return []
  const exact: UniverseEntry[] = []
  const prefix: UniverseEntry[] = []
  const substr: UniverseEntry[] = []

  const consider = (e: UniverseEntry) => {
    const sym = e.symbol.toUpperCase()
    if (sym === q) exact.push(e)
    else if (sym.startsWith(q)) prefix.push(e)
    else if (e.name.toUpperCase().includes(q)) substr.push(e)
  }

  for (const e of catalog) consider(e)
  for (const [symbol, name] of equities) {
    consider({ symbol, name, assetClass: "equity" })
    if (exact.length + prefix.length + substr.length > limit * 4) break
  }

  return [...exact, ...prefix, ...substr].slice(0, limit)
}
