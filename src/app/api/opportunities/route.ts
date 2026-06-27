// GET /api/opportunities — list with optional filters.
// Read-only; no auth required (dashboard endpoint).

import { listOpportunities, type AssetClass, type OpportunityStatus } from "@/lib/opportunities/store"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const source = url.searchParams.get("source") ?? undefined
  const status = (url.searchParams.get("status") ?? undefined) as OpportunityStatus | undefined
  const asset_class = (url.searchParams.get("asset_class") ?? undefined) as AssetClass | undefined
  const instrument = url.searchParams.get("instrument") ?? undefined
  const limit = Number(url.searchParams.get("limit") ?? 100)

  const opportunities = await listOpportunities({
    source, status, asset_class, instrument, limit,
  })

  return Response.json({
    opportunities,
    count: opportunities.length,
    filters: { source, status, asset_class, instrument, limit },
  })
}
