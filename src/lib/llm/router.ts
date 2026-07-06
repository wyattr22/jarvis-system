import { redis } from "@/lib/cache/redis"
import { callProvider, MODELS, modelsByPriority, type ModelSpec, type ModelFamily } from "./providers"

const QUOTA_PREFIX = "llm:quota:"
const CACHE_PREFIX = "llm:cache:"
const CACHE_TTL = 3600

type RouterRequest = {
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  preferredModel?: string
  requiredFamily?: ModelFamily
  temperature?: number
  maxTokens?: number
  cacheable?: boolean
}

async function getQuotaUsed(modelKey: string): Promise<number> {
  const used = await redis.get<number>(`${QUOTA_PREFIX}${modelKey}`)
  return used ?? 0
}

async function incrementQuota(modelKey: string, tokens: number) {
  const key = `${QUOTA_PREFIX}${modelKey}`
  await redis.incrby(key, tokens)
  // TTL resets to next midnight UTC (approx 86400s)
  await redis.expire(key, 86400)
}

function cacheKey(messages: RouterRequest["messages"]): string {
  const payload = JSON.stringify(messages)
  // Simple hash: length + first 50 + last 50 chars
  return `${CACHE_PREFIX}${payload.length}:${payload.slice(0, 50)}:${payload.slice(-50)}`
}

export async function route(req: RouterRequest): Promise<string> {
  // Check cache first
  if (req.cacheable !== false) {
    const cached = await redis.get<string>(cacheKey(req.messages))
    if (cached) return cached
  }

  // Build candidate list ordered by preference
  const candidates = buildCandidates(req.preferredModel, req.requiredFamily)

  for (const [key, model] of candidates) {
    const used = await getQuotaUsed(key)
    if (used >= model.dailyQuota * 0.95) continue // leave 5% buffer

    try {
      const result = await callProvider({ model, messages: req.messages, temperature: req.temperature, maxTokens: req.maxTokens })
      await incrementQuota(key, estimateTokens(req.messages, result))

      if (req.cacheable !== false) {
        await redis.setex(cacheKey(req.messages), CACHE_TTL, result)
      }
      return result
    } catch {
      // Try next provider
      continue
    }
  }

  throw new Error("All LLM providers exhausted or over quota")
}

function buildCandidates(preferredModel?: string, requiredFamily?: ModelFamily): [string, ModelSpec][] {
  const all = modelsByPriority()

  if (preferredModel && MODELS[preferredModel]) {
    const preferred = MODELS[preferredModel]
    const rest = all.filter(([k]) => k !== preferredModel)
    return [[preferredModel, preferred], ...rest]
  }

  if (requiredFamily) {
    return all.filter(([, m]) => m.family === requiredFamily)
  }

  return all
}

function estimateTokens(messages: RouterRequest["messages"], response: string): number {
  const inputChars = messages.reduce((s, m) => s + m.content.length, 0)
  return Math.ceil(inputChars / 4) + Math.ceil(response.length / 4)
}

export async function routeWithDiversity(
  requests: RouterRequest[],
): Promise<string[]> {
  const usedFamilies = new Set<ModelFamily>()
  const results: string[] = []

  for (const req of requests) {
    // Force different family from already-used ones
    const candidates = Object.entries(MODELS).filter(([, m]) => !usedFamilies.has(m.family))
    if (candidates.length === 0) {
      // All families exhausted, allow reuse but tag as low-diversity
      results.push(await route(req))
    } else {
      const [, model] = candidates[0]
      usedFamilies.add(model.family)
      results.push(await route({ ...req, preferredModel: candidates[0][0] }))
    }
  }

  return results
}
