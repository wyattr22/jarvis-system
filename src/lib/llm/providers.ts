import { safeFetch } from "@/lib/sandbox/whitelist"

export type ModelFamily = "llama" | "qwen" | "deepseek" | "mistral" | "gemma"
// SambaNova removed 2026-07-05: one-time $5 credit (not a renewable free
// tier) and it never had a callProvider case — dead weight in the chain.
export type ProviderName = "groq" | "cerebras" | "openrouter" | "cloudflare"

export interface ModelSpec {
  provider: ProviderName
  modelId: string
  family: ModelFamily
  contextWindow: number
  dailyQuota: number
  rpm: number
  /** Lower = tried earlier. Explicit so candidate order never depends on
   *  object-declaration order. Cerebras first: 1M tokens/day free vs
   *  Groq's ~1K requests/day. */
  priority: number
}

export const MODELS: Record<string, ModelSpec> = {
  "cerebras-llama-70b": {
    provider: "cerebras",
    modelId: "llama-3.3-70b",
    family: "llama",
    contextWindow: 128000,
    dailyQuota: 1000000,
    rpm: 30,
    priority: 1,
  },
  "groq-llama-70b": {
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    family: "llama",
    contextWindow: 128000,
    dailyQuota: 500000,
    rpm: 30,
    priority: 2,
  },
  "groq-llama-8b": {
    provider: "groq",
    modelId: "llama-3.1-8b-instant",
    family: "llama",
    contextWindow: 128000,
    dailyQuota: 500000,
    rpm: 30,
    priority: 3,
  },
  "cerebras-qwen-32b": {
    provider: "cerebras",
    modelId: "qwen-3-32b",
    family: "qwen",
    contextWindow: 32000,
    dailyQuota: 1000000,
    rpm: 30,
    priority: 4,
  },
  "openrouter-deepseek-r1": {
    provider: "openrouter",
    modelId: "deepseek/deepseek-r1:free",
    family: "deepseek",
    contextWindow: 64000,
    dailyQuota: 200,
    rpm: 10,
    priority: 5,
  },
}

/** MODELS entries sorted by explicit priority (lowest first). */
export function modelsByPriority(): [string, ModelSpec][] {
  return Object.entries(MODELS).sort((a, b) => a[1].priority - b[1].priority)
}

export type ProviderRequest = {
  model: ModelSpec
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  temperature?: number
  maxTokens?: number
}

// Throws before any network call when a provider key is missing, so the
// router can skip the provider cheaply instead of sending a guaranteed 401.
function requireKey(envVar: string): string {
  const value = process.env[envVar]
  if (!value) throw new Error(`${envVar} not configured`)
  return value
}

async function callGroq(req: ProviderRequest): Promise<string> {
  const apiKey = requireKey("GROQ_API_KEY")
  const res = await safeFetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model.modelId,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 4096,
    }),
  })
  if (!res.ok) throw new Error(`Groq error: ${res.status}`)
  const json = await res.json()
  return json.choices[0].message.content
}

async function callCerebras(req: ProviderRequest): Promise<string> {
  const apiKey = requireKey("CEREBRAS_API_KEY")
  const res = await safeFetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model.modelId,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 4096,
    }),
  })
  if (!res.ok) throw new Error(`Cerebras error: ${res.status}`)
  const json = await res.json()
  return json.choices[0].message.content
}

async function callOpenRouter(req: ProviderRequest): Promise<string> {
  const apiKey = requireKey("OPENROUTER_API_KEY")
  const res = await safeFetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://jarvis-system.vercel.app",
    },
    body: JSON.stringify({
      model: req.model.modelId,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 4096,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`)
  const json = await res.json()
  return json.choices[0].message.content
}

export async function callProvider(req: ProviderRequest): Promise<string> {
  switch (req.model.provider) {
    case "groq": return callGroq(req)
    case "cerebras": return callCerebras(req)
    case "openrouter": return callOpenRouter(req)
    default: throw new Error(`Provider ${req.model.provider} not implemented`)
  }
}