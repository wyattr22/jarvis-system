// Current rotating universe (12.3). Public read for dashboards + consumers.

import { getUniverseRows } from "@/lib/universe/store"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 150), 500)
  try {
    const rows = await getUniverseRows(limit)
    return Response.json({ universe: rows, count: rows.length })
  } catch (err) {
    return Response.json({ error: String(err), universe: [] }, { status: 500 })
  }
}
