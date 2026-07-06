// Shadow vs live comparison (12.7).
// GET /api/analysis/shadow?days=30

import { getShadowComparison } from "@/lib/analysis/shadow"

export const maxDuration = 120

export async function GET(req: Request) {
  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 90)
  try {
    const result = await getShadowComparison(days)
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
