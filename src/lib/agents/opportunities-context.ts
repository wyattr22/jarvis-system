// Council-side summary of the unified opportunities feed.
// Researcher + Critics get this snapshot so the council reasons over the
// full cross-project pipeline, not just historical trades.

import { listOpportunities } from "@/lib/opportunities/store"

export type OpportunitiesCouncilContext = {
  total_open: number
  by_source: Record<string, number>
  by_asset_class: Record<string, number>
  // top 5 high-confidence open opportunities for the council to reference
  top: Array<{
    id: string
    source: string
    asset_class: string
    instrument: string
    side: string
    thesis: string
    expected_r?: number
    win_prob?: number
    confidence?: number
  }>
}

export async function getOpportunitiesForCouncil(): Promise<OpportunitiesCouncilContext> {
  const opps = await listOpportunities({ status: "open", limit: 200 })

  const by_source: Record<string, number> = {}
  const by_asset_class: Record<string, number> = {}
  for (const o of opps) {
    by_source[o.source] = (by_source[o.source] ?? 0) + 1
    by_asset_class[o.asset_class] = (by_asset_class[o.asset_class] ?? 0) + 1
  }

  // High-confidence subset, ranked by score
  const top = opps
    .filter(o => (o.confidence ?? 0) >= 0.5)
    .map(o => ({
      opp: o,
      score: (o.expected_r ?? 1) * (o.win_prob ?? 0.5) * (o.confidence ?? 0.5),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ opp }) => ({
      id: opp.id,
      source: opp.source,
      asset_class: opp.asset_class,
      instrument: opp.instrument,
      side: opp.side,
      thesis: opp.thesis,
      expected_r: opp.expected_r,
      win_prob: opp.win_prob,
      confidence: opp.confidence,
    }))

  return {
    total_open: opps.length,
    by_source,
    by_asset_class,
    top,
  }
}
