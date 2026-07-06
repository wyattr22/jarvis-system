// Cross-asset symbol search for typeaheads (11.8, Finnhub fallback 11.3).
// GET /api/symbols/search?q=ES  ->  { results: UniverseEntry[] }

import { getEquityUniverse, catalogEntries, rankSymbolMatches, type UniverseEntry } from "@/lib/instruments/universe"
import { searchFinnhubSymbols } from "@/lib/data/finnhub"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? ""
  if (q.trim().length < 1) return Response.json({ results: [] })

  try {
    const equities = await getEquityUniverse().catch(() => [] as [string, string][])
    let results = rankSymbolMatches(q, equities, catalogEntries())

    // Finnhub fallback for misses (e.g. name-only queries the compact
    // universe index can't resolve). Budgeted; no-op without the key.
    if (results.length < 3) {
      const finnhub = await searchFinnhubSymbols(q)
      const seen = new Set(results.map(r => r.symbol))
      const extra: UniverseEntry[] = finnhub
        .filter(f => f.type === "Common Stock" && !seen.has(f.symbol) && !f.symbol.includes("."))
        .map(f => ({ symbol: f.symbol, name: f.description, assetClass: "equity" as const }))
      results = [...results, ...extra].slice(0, 20)
    }

    return Response.json({ results })
  } catch (err) {
    return Response.json({ error: String(err), results: [] }, { status: 502 })
  }
}
