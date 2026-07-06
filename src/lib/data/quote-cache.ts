// Budget-aware quote cache. Composes the shared Redis cache with the
// provider budgeter and a long-lived stale shadow copy:
//
//   fresh cache hit            -> return it (no budget spent)
//   miss + under budget        -> fetch origin, write cache + shadow
//   miss + over budget         -> serve shadow marked stale
//   fetch error                -> serve shadow if present, else rethrow
//
// The shadow copy means a Yahoo outage or a burned budget degrades a tile to
// "stale + badge" instead of blanking the page.

import { redis } from "@/lib/cache/redis"
import { underBudget } from "./budget"

const SHADOW_TTL_SECONDS = 24 * 60 * 60

export interface CachedResult<T> {
  value: T
  /** True when served from the stale shadow rather than a fresh fetch/cache */
  stale: boolean
}

export async function cachedQuote<T>(
  provider: string,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<CachedResult<T>> {
  const cacheKey = `quote:${key}`
  const shadowKey = `stale:${key}`

  const hit = await redis.get<T>(cacheKey)
  if (hit !== null) return { value: hit, stale: false }

  if (!(await underBudget(provider))) {
    const shadow = await redis.get<T>(shadowKey)
    if (shadow !== null) return { value: shadow, stale: true }
    // No shadow to fall back on — fetch anyway rather than return nothing.
  }

  try {
    const value = await fetcher()
    await redis.setex(cacheKey, ttlSeconds, value as string)
    await redis.setex(shadowKey, SHADOW_TTL_SECONDS, value as string)
    return { value, stale: false }
  } catch (err) {
    const shadow = await redis.get<T>(shadowKey)
    if (shadow !== null) return { value: shadow, stale: true }
    throw err
  }
}
