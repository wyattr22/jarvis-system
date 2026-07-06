// Fixed-window request budgeter for free-tier data providers.
// Callers check underBudget() before an origin fetch; when over budget they
// serve the stale shadow copy (see quote-cache.ts) instead of burning the cap.

import { redis } from "@/lib/cache/redis"

export interface BudgetSpec {
  /** Max origin requests per window */
  limit: number
  /** Window length in seconds */
  windowSeconds: number
}

// Limits sit safely under each provider's hard cap:
//   finnhub hard cap 60/min; alphavantage hard cap 25/day;
//   alpaca data hard cap 200/min; yahoo is unofficial — self-imposed politeness.
export const BUDGETS: Record<string, BudgetSpec> = {
  finnhub: { limit: 55, windowSeconds: 60 },
  alphavantage: { limit: 22, windowSeconds: 86400 },
  alpaca_data: { limit: 180, windowSeconds: 60 },
  yahoo: { limit: 120, windowSeconds: 60 },
}

function windowKey(provider: string, spec: BudgetSpec, now: number): string {
  const window = Math.floor(now / 1000 / spec.windowSeconds)
  return `budget:${provider}:${window}`
}

/**
 * Increment the provider's window counter and report whether this request is
 * within budget. Unknown providers are always allowed. Fails open: if Redis
 * is unreachable the fetch proceeds (a data outage is worse than a rare
 * over-cap request).
 */
export async function underBudget(provider: string, now: number = Date.now()): Promise<boolean> {
  const spec = BUDGETS[provider]
  if (!spec) return true
  try {
    const key = windowKey(provider, spec, now)
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, spec.windowSeconds + 5)
    return count <= spec.limit
  } catch {
    return true
  }
}
