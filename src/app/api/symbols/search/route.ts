// Cross-asset symbol search for typeaheads (11.8).
// GET /api/symbols/search?q=ES  ->  { results: UniverseEntry[] }

import { getEquityUniverse, catalogEntries, rankSymbolMatches } from "@/lib/instruments/universe"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? ""
  if (q.trim().length < 1) return Response.json({ results: [] })

  try {
    const equities = await getEquityUniverse().catch(() => [] as [string, string][])
    const results = rankSymbolMatches(q, equities, catalogEntries())
    return Response.json({ results })
  } catch (err) {
    return Response.json({ error: String(err), results: [] }, { status: 502 })
  }
}
