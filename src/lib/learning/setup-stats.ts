// Outcome-weighted grounding: when the user asks about a known setup type,
// surface real recent trade stats so Jarvis grounds his claim in measured
// performance rather than philosophical priors.

import { db } from "@/lib/db/client"

const SETUP_KEYWORDS: Record<string, string[]> = {
  FVG:  ['fvg', 'fair value gap'],
  OB:   ['order block', ' ob '],
  OTE:  ['ote', 'optimal trade entry'],
  BSL:  ['bsl', 'buy side liquidity', 'buy-side'],
  SSL:  ['ssl', 'sell side liquidity', 'sell-side'],
  IFVG: ['ifvg', 'inverse fair value'],
  BOS:  ['bos', 'break of structure'],
  CHOCH: ['choch', 'change of character'],
}

export function detectSetup(query: string): string | null {
  const lower = ` ${query.toLowerCase()} `
  for (const [setup, kws] of Object.entries(SETUP_KEYWORDS)) {
    if (kws.some(k => lower.includes(k))) return setup
  }
  return null
}

const DAY = 24 * 60 * 60 * 1000

export async function getSetupStatLine(setup: string): Promise<string> {
  // Without a setup_type column on trades, we look up signals whose
  // reasoning_json mentions the setup and join to their trades.
  try {
    const since = Date.now() - 30 * DAY
    const r = await db.execute({
      sql: `
        SELECT t.r_multiple, t.opened_at
        FROM trades t
        JOIN signals s ON s.id = t.signal_id
        WHERE t.r_multiple IS NOT NULL
          AND t.opened_at >= ?
          AND (s.reasoning_json LIKE ? OR s.reasoning_json LIKE ?)
        ORDER BY t.opened_at DESC
        LIMIT 50
      `,
      args: [since, `%"${setup}"%`, `%"${setup.toLowerCase()}"%`],
    })
    if (!r.rows.length) return ""

    const rs = r.rows.map(x => Number((x as any).r_multiple))
    const wins = rs.filter(x => x > 0).length
    const losses = rs.length - wins
    const avgR = rs.reduce((a, b) => a + b, 0) / rs.length
    const last = Number((r.rows[0] as any).opened_at)
    const daysAgo = Math.floor((Date.now() - last) / DAY)
    return `RECENT EXECUTION ON ${setup} (last 30d): ${wins}W/${losses}L, avg_R=${avgR.toFixed(2)}, last_trade=${daysAgo}d ago`
  } catch {
    return ""
  }
}

// Convenience wrapper: detect + fetch in one call. Returns "" if no setup mentioned
// or no trades on that setup yet.
export async function maybeSetupStats(query: string): Promise<string> {
  const setup = detectSetup(query)
  if (!setup) return ""
  return getSetupStatLine(setup)
}
