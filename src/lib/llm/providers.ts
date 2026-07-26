import { safeFetch } from "@/lib/sandbox/whitelist"

export type ModelFamily = "llama" | "qwen" | "deepseek" | "mistral" | "gemma" | "gemini"
// SambaNova removed 2026-07-05: one-time $5 credit (not a renewable free
// tier) and it never had a callProvider case — dead weight in the chain.
// "cloudflare" removed 2026-07-25 (Phase 19): was declared here but never
// had a callProvider case, a MODELS entry, or an env var anywhere — dead
// weight, same as SambaNova was.
export type ProviderName = "groq" | "cerebras" | "openrouter" | "google" | "ollama"

/**
 * Cost/latency tier (Phase 19) — lets a call site ask for "cheap" (fast,
 * free-tier, fine for high-frequency/low-stakes work like critic votes or
 * knowledge-graph extraction) vs "premium" (reserved for reasoning that
 * actually matters — strategy authorship, risk vetoes) vs "free-local"
 * (zero cost, but only reachable when Jarvis is running as a local dev
 * server — see callOllama's comment on why this can never work from a
 * deployed Vercel function).
 */
export type CostTier = "free-local" | "cheap" | "premium"

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
  costTier: CostTier
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
    costTier: "cheap",
  },
  "groq-llama-70b": {
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    family: "llama",
    contextWindow: 128000,
    dailyQuota: 500000,
    rpm: 30,
    priority: 2,
    costTier: "cheap",
  },
  "groq-llama-8b": {
    provider: "groq",
    modelId: "llama-3.1-8b-instant",
    family: "llama",
    contextWindow: 128000,
    dailyQuota: 500000,
    rpm: 30,
    priority: 3,
    costTier: "cheap",
  },
  "cerebras-qwen-32b": {
    provider: "cerebras",
    modelId: "qwen-3-32b",
    family: "qwen",
    contextWindow: 32000,
    dailyQuota: 1000000,
    rpm: 30,
    priority: 4,
    costTier: "cheap",
  },
  "openrouter-deepseek-r1": {
    provider: "openrouter",
    modelId: "deepseek/deepseek-r1:free",
    family: "deepseek",
    contextWindow: 64000,
    dailyQuota: 200,
    rpm: 10,
    priority: 5,
    costTier: "premium",
  },
  // Gemini Flash (Phase 19) — verified live 2026-07-25 against Google's own
  // OpenAI-compatibility docs: real endpoint, real current model id. The
  // dailyQuota below is a conservative placeholder, NOT a confirmed number
  // — Google doesn't publish free-tier RPM/RPD statically, only per-project
  // in AI Studio (https://aistudio.google.com/rate-limit). Tune this once
  // GOOGLE_API_KEY is live; see KNOWN_ISSUES.md.
  "google-gemini-flash": {
    provider: "google",
    modelId: "gemini-3.6-flash",
    family: "gemini",
    contextWindow: 1000000,
    dailyQuota: 1500,
    rpm: 10,
    priority: 6,
    costTier: "cheap",
  },
  // Local Ollama (Phase 19) — only ever reachable when Jarvis runs as a
  // local dev server; OLLAMA_HOST is unset in production, so this candidate
  // simply fails-and-falls-through in route()'s existing loop there (no
  // special-casing needed — see router.ts). modelId defaults to a common
  // pull but is configurable since we can't know what the user has pulled.
  "ollama-local": {
    provider: "ollama",
    modelId: process.env.OLLAMA_MODEL ?? "llama3.1",
    family: "llama",
    contextWindow: 128000,
    dailyQuota: Number.MAX_SAFE_INTEGER, // local compute, no external quota
    rpm: 60,
    priority: 7,
    costTier: "free-local",
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

async function callGoogle(req: ProviderRequest): Promise<string> {
  const apiKey = requireKey("GOOGLE_API_KEY")
  const res = await safeFetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
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
  if (!res.ok) throw new Error(`Google error: ${res.status}`)
  const json = await res.json()
  return json.choices[0].message.content
}

// Ollama has a real OpenAI-compatible endpoint (verified live 2026-07-25:
// /v1/chat/completions, identical request/response shape to every other
// provider here) — no bespoke parsing needed. An API key is "required but
// ignored" for a local instance; the dummy value below is what Ollama's own
// docs recommend, not a real credential.
//
// This can only ever succeed when Jarvis is running as a local dev server.
// Vercel serverless functions have no route to a user's home network, full
// stop — in production OLLAMA_HOST is unset, requireKey-equivalent logic
// below throws before any fetch, and route()'s existing fall-through-on-
// error loop moves on to the next candidate exactly like any other
// transient provider failure. No special-casing required there.
async function callOllama(req: ProviderRequest): Promise<string> {
  const host = process.env.OLLAMA_HOST
  if (!host) throw new Error("OLLAMA_HOST not configured")
  const res = await safeFetch(`${host}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer ollama",
    },
    body: JSON.stringify({
      model: req.model.modelId,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 4096,
    }),
  })
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
  const json = await res.json()
  return json.choices[0].message.content
}

export async function callProvider(req: ProviderRequest): Promise<string> {
  switch (req.model.provider) {
    case "groq": return callGroq(req)
    case "cerebras": return callCerebras(req)
    case "openrouter": return callOpenRouter(req)
    case "google": return callGoogle(req)
    case "ollama": return callOllama(req)
    default: throw new Error(`Provider ${req.model.provider} not implemented`)
  }
}