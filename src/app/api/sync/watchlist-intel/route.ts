// Daily cron: auto-promote/demote symbols on the watchlist based on
// opportunity flow + user mutes.

import { runWatchlistIntel } from "@/lib/learning/watchlist-intel"

export const maxDuration = 30

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const result = await runWatchlistIntel()
  const promoted = result.decisions.filter(d => d.action === "promote").length
  const demoted = result.decisions.filter(d => d.action === "demote").length
  return Response.json({
    ok: true,
    promoted,
    demoted,
    decisions: result.decisions,
    ts: Date.now(),
  })
}
