// Sandbox: every outbound request MUST go through safeFetch.
// Hosts not in ALLOWED_HOSTS are rejected to prevent open-web access.
// Blocked attempts are logged to audit_log for review.

import { auditLog } from "@/lib/guardrails/audit"

function dbHost(envVar: string | undefined): string | null {
  if (!envVar) return null
  try { return new URL(envVar).host } catch { return null }
}

const ALLOWED_HOSTS = new Set<string>([
  // Market data
  "data.alpaca.markets",
  "paper-api.alpaca.markets",
  "api.alpaca.markets",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "www.alphavantage.co",
  // SEC + public filings
  "data.sec.gov",
  "efts.sec.gov",
  "www.sec.gov",
  // Public sentiment (user-approved)
  "api.stocktwits.com",
  // LLM compute
  "api.groq.com",
  "api.cerebras.ai",
  "openrouter.ai",
  // TTS compute
  "api.elevenlabs.io",
  "api.streamelements.com",
  // HuggingFace model CDN (Transformers.js downloads model weights on first run)
  "huggingface.co",
  "cdn-lfs.huggingface.co",
  // Internal projects pushing opportunities (will be Vercel-hosted, so the
  // *.vercel.app wildcard already covers them — listing here for documentation).
  // - splitwatch (production URL TBD; preview URLs covered by *.vercel.app wildcard)
  // - swing_scanner (production URL TBD; same)

  // Display-only news RSS — feeds the /news page UI, NEVER enters predictive model
  // (the source quality gate will tag these as confidence=0 for any predictive use)
  "feeds.marketwatch.com",
  "search.cnbc.com",
  "feeds.reuters.com",
  "www.thestreet.com",
  "finance.yahoo.com",
  "feeds.finance.yahoo.com",
  "www.investing.com",
  "www.nasdaq.com",
  "www.fool.com",
  "www.barrons.com",
  "feed.businesswire.com",
  // Internal infra
  dbHost(process.env.TURSO_DATABASE_URL) ?? "",
  dbHost(process.env.UPSTASH_REDIS_REST_URL) ?? "",
].filter(Boolean))

async function logBlocked(host: string, url: string): Promise<void> {
  try {
    await auditLog("sandbox", "blocked_fetch", { host, url: url.slice(0, 300) })
  } catch { /* audit failure is non-critical */ }
}

// Wildcard suffixes: any host ending with one of these is allowed.
// Use sparingly — only for trusted multi-tenant platforms where subdomains belong to us.
const ALLOWED_SUFFIXES = [
  ".vercel.app",     // our own preview + production deployments
  ".turso.io",       // Turso edge database
  ".upstash.io",     // Upstash Redis
]

export function isAllowedHost(host: string): boolean {
  if (ALLOWED_HOSTS.has(host)) return true
  for (const suffix of ALLOWED_SUFFIXES) {
    if (host.endsWith(suffix)) return true
  }
  return false
}

export async function safeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString()
  const host = new URL(url).host
  if (!isAllowedHost(host)) {
    await logBlocked(host, url)
    throw new Error(`SANDBOX: blocked outbound to ${host}`)
  }
  return fetch(url, init)
}

export function getAllowedHosts(): string[] {
  return [...ALLOWED_HOSTS]
}
