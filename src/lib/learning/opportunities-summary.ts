// Build a short text summary of top open opportunities for voice context.
// Gated by confidence ≥ 0.5 so the model never reasons against low-quality sources.

import { listOpportunities } from "@/lib/opportunities/store"

const CONFIDENCE_FLOOR = 0.5
const TOP_N = 3

export async function getOpportunitiesContextLine(): Promise<string> {
  try {
    const opps = await listOpportunities({ status: "open", limit: 50 })
    if (!opps.length) return ""

    const ranked = opps
      .filter(o => (o.confidence ?? 0) >= CONFIDENCE_FLOOR)
      .map(o => ({
        opp: o,
        score: (o.expected_r ?? 1) * (o.win_prob ?? 0.5) * (o.confidence ?? 0.5),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N)

    if (!ranked.length) {
      return `OPEN OPPORTUNITIES: ${opps.length} total, but none clear the 0.50 confidence floor.`
    }

    const lines = ranked.map(({ opp, score }) => {
      const r = opp.expected_r?.toFixed(1) ?? "?"
      const wp = opp.win_prob !== undefined ? `${(opp.win_prob * 100).toFixed(0)}%` : "?"
      return `${opp.source}:${opp.instrument} ${opp.side} expR=${r} win=${wp} score=${score.toFixed(2)}`
    })
    return `OPEN OPPORTUNITIES (${opps.length} total, top ${ranked.length} by score): ${lines.join(' | ')}`
  } catch {
    return ""
  }
}
