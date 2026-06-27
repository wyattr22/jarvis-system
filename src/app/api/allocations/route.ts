// GET /api/allocations — execution history.
// Read-only; no auth (dashboard endpoint).

import { listAllocations } from "@/lib/allocator/allocations"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get("limit") ?? 100)
  const allocations = await listAllocations(limit)
  return Response.json({ allocations, count: allocations.length })
}
