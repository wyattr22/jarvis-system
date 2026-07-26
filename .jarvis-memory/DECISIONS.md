# Decisions Log (ADR-style)

Append-only. New decisions go at the top. Format:

```
## YYYY-MM-DD — <one-line decision>

**Context:** what was the problem?
**Decision:** what did we choose?
**Why:** why this over alternatives?
**Consequences:** what does this commit us to?
```

---

## 2026-07-25 — Phase 19: added Google/Ollama providers + cost tiers; Kimi K2/Qwen deliberately NOT added

**Context:** User asked to use local models, Gemini Flash, Qwen, and Kimi K2
to make the LLM layer more efficient — route high-frequency/low-stakes calls
(critic votes, future knowledge-graph extraction) to fast/free models,
reserve expensive reasoning for strategy authorship and risk vetoes. The
existing router only knew 3 cloud providers (Groq/Cerebras/OpenRouter), all
competing on one priority list with no cost/latency tiering.

**Decision:** Added `google` and `ollama` to `ProviderName`, each with a
`callGoogle()`/`callOllama()` — both plain OpenAI-compatible REST calls
(verified live 2026-07-25 against each project's own docs, not assumed from
training data: Gemini's real OpenAI-compat endpoint is
`generativelanguage.googleapis.com/v1beta/openai/chat/completions` with
current model id `gemini-3.6-flash`; Ollama's is `{OLLAMA_HOST}/v1/chat/
completions`, dummy API key). Added `ModelSpec.costTier: "free-local" |
"cheap" | "premium"` and `RouterRequest.preferredCostTier` so a call site can
ask for a tier instead of (or alongside) a specific model.
`google-gemini-flash` → cheap, `ollama-local` → free-local, existing 4
free-tier models stay cheap, `openrouter-deepseek-r1` stays the one premium
entry. Also removed the dead `"cloudflare"` `ProviderName` (declared since
before this repo's git history but never had a `callProvider` case, a
`MODELS` entry, or an env var — same category of dead weight as SambaNova).

**Local Ollama's host is whitelisted narrowly, not generally**: `whitelist.ts`
reads `OLLAMA_HOST` once and allows that *exact* host:port string — same
mechanism as the existing Turso/Upstash DB-host exceptions, deliberately not
a general "allow private IPs" rule (that would be an SSRF door). No-op in
production since `OLLAMA_HOST` is never set there; `route()`'s existing
fall-through-on-error loop already handles an unreachable candidate
correctly with zero special-casing (proved in `router.test.ts`).

**Kimi K2 and Qwen were explicitly NOT added, on purpose.** Live-probed
OpenRouter's model catalog (`api/v1/models`) on 2026-07-25: the closest
current matches are `moonshotai/kimi-k3`, `moonshotai/kimi-k2.7-code`,
`qwen/qwen3.7-plus`, `qwen/qwen3.7-max` — **none has a free-tier variant**
(all have nonzero prompt pricing). The router's only cost-control mechanism
today (`dailyQuota` + Redis quota tracking in `router.ts`) is a *request/
token-count* budget, not a *dollar-spend* budget — it was built entirely
around free-tier providers and has no concept of "stop before we've spent
$X." Wiring in a paid-only model through that mechanism as-is would mean an
autonomous agent (this router is called from cron-triggered code with no
human in the loop per-call) could rack up real charges with nothing capping
total spend.

**Why:** Every other provider in this repo was chosen specifically for a
free tier (see the `.env.example` "all free tiers" comment, and the original
choice of Groq/Cerebras/OpenRouter over paid alternatives). Silently
breaking that invariant by wiring in a paid model — even a cheap one — isn't
a call to make without the user explicitly deciding on it and setting a
spend cap; it's not something a live-probe result should quietly paper over
by picking the closest-sounding paid model instead.

**Consequences:** If/when a free tier appears for a Kimi- or Qwen-family
model on OpenRouter (or elsewhere), adding it is now trivial — just a new
`MODELS` entry, zero new provider code, exactly like `openrouter-deepseek-r1`
already works. Until then, the *local Ollama* provider added in this same
phase is the actual way to run open-weight Kimi/Qwen-family models for free
today (pull one via `ollama pull`, point `OLLAMA_MODEL` at it) — with the
caveat that it only works from a local dev server, never from the deployed
production cron jobs. Flagged prominently for the user rather than silently
delivered as "done."

---

## 2026-06-26 — Branch-per-step + PR review workflow

**Context:** Project had a single commit on `main` and no GitHub remote. Solo
developer-grade workflow needed before scaling to multiple projects via MCP.

**Decision:** Every numbered plan step = one feature branch
(`phase-X.Y/short-description`) = one PR = one squash-merge to `main`.
Conventional commits. CI must pass (typecheck + lint + build + tests).
Branch protection blocks direct pushes to `main`.

**Why:** Atomic, reviewable diffs. Future collaborators inherit a clean
workflow. Forces self-review discipline. Easy to revert any single step.

**Consequences:** Every change ships behind a PR — slightly slower iteration,
substantially higher confidence. We never `--no-verify` or bypass hooks.

---

## 2026-06-26 — Markdown file system as cross-session memory

**Context:** Sessions kept losing context. Manual re-explanation was expensive
and error-prone. Jarvis himself also has no persistent runtime memory across
LLM calls beyond what's in Turso.

**Decision:** `.jarvis-memory/` directory at repo root, git-tracked, plain
markdown. Files: INDEX.md (always read first), CURRENT_PHASE.md (live state),
DECISIONS.md (this file), KNOWN_ISSUES.md (open blockers), phases/*, sessions/*,
domain/*. CLAUDE.md teaches every Claude Code session to read INDEX.md at
startup. `getJarvisMemory()` reader exposes the same files to Jarvis's voice
route for runtime injection.

**Why:** Markdown is human-readable, LLM-friendly, version-controlled, and
free. No external service. Survives session boundaries, repo clones, and
collaborator onboarding.

**Consequences:** Every PR touches at minimum `CURRENT_PHASE.md`. PR template
enforces this. Memory drift is impossible because it's tracked in git
alongside the code that depends on it.

---

## 2026-06-26 — MCP transport: HTTP + SSE (not stdio)

**Context:** Choosing how external projects (splitwatch, swing_scanner,
Claude Desktop) talk to Jarvis's MCP server.

**Decision:** HTTP + Server-Sent Events on `/api/mcp`. POST for JSON-RPC,
GET for SSE streaming.

**Why:** Vercel-native (stdio doesn't work on serverless). Claude Desktop can
still connect via the `mcp-remote` bridge. Future Claude Code, Claude Desktop,
and arbitrary HTTP clients all work without protocol divergence.

**Consequences:** No local-only stdio fast-path. Auth required on every
request (we standardised on bearer tokens — see next entry).

---

## 2026-06-26 — Per-project bearer-token auth for MCP

**Context:** Multi-project access needs identity. OAuth would be heavyweight
for a solo build.

**Decision:** Each external project (splitwatch, swing_scanner, trading_bot,
Claude clients) gets a bearer token. Tokens stored as SHA-256 hashes in
`mcp_clients` table with per-token JSON scopes. Validated in
`src/lib/mcp/auth.ts` middleware on every MCP request.

**Why:** Simple, debuggable, sufficient until multi-user. Mirrors the existing
CRON_SECRET pattern. JWT/OAuth upgrade path remains open.

**Consequences:** Token rotation requires admin endpoint hit. Compromised
token = entire project compromised — keep scopes narrow per client.

---

## 2026-06-26 — Hybrid federated data model across projects

**Context:** Each project (jarvis-system, basket-trader, splitwatch) has its
own DB. Centralising everything into Turso would be a massive migration.

**Decision:** Each project keeps its own database. Jarvis-system Turso
mirrors only the cross-project events: opportunities, allocations, executions.
Project-specific data (full filings, full chat history, etc.) stays in the
project's own DB and is queried via MCP tools that proxy to that project.

**Why:** Onboard projects without migrations. Jarvis still gets unified
observability for decision-making. Each project owns its data and stays
deployable independently.

**Consequences:** Cross-project queries are MCP-tool round-trips, not SQL
joins. Slower for analytics but cleaner ownership boundaries.

---

## 2026-06-26 — Hard sandbox via safeFetch + source-quality gate

**Context:** Trading systems must never silently consume bad or unauthorised
data sources. LLM-suggested code changes could introduce new fetches that
reach the open web.

**Decision:** Every outbound `fetch()` goes through `src/lib/sandbox/whitelist.ts`
`safeFetch()`. Hosts not in `ALLOWED_HOSTS` throw immediately and log to
audit_log. Every external feed wrapped in `src/lib/sandbox/quality.ts`
`evaluateSource()` which scores confidence; data with `confidence < 0.5` is
stripped from LLM context but still rendered on the dashboard with a badge.

**Why:** Defence in depth. Future code (mine or someone else's) cannot
accidentally reach the open web. The gate also gives the council real
information about source reliability over time.

**Consequences:** New data sources require explicit whitelist entry + source
spec. Adds 30 seconds of friction per new integration. Worth it.

---

## 2026-06-26 — Semantic search via Transformers.js (TF-IDF fallback)

**Context:** 564+ memories + 500 research papers needed semantic retrieval, not
just raw keyword match.

**Decision:** `@xenova/transformers` runs the `all-MiniLM-L6-v2` model
in-function. Falls back to TF-IDF re-ranking when the model can't load (Vercel
Lambda lacks native ONNX runtime; WASM backend incomplete). Embeddings
stored as BLOB columns on `research_chunks` and `jarvis_memory`.

**Why:** Zero outbound calls (no HuggingFace API). Zero new infrastructure.
TF-IDF alone is already 3-4× better than the previous raw term count.

**Consequences:** Semantic mode only works when ONNX backend is available.
Most production calls hit the TF-IDF path. If we need true semantic later we
can swap in a different runtime (Edge function or external embeddings service)
without touching consumers.

---

## 2026-07-05 — Futures/index visibility: delayed Yahoo + live ETF proxy pairing

**Context:** Phase 11 needs futures + index visibility on a free-tier-only
budget. Probes with the project key: Alpaca has NO futures data at any tier;
Alpaca's new indices endpoint (June 2026) returns 403 on free Basic. Real-time
CME data legally requires ~$25/mo API + $290–500/mo CME license — rejected.

**Decision:** Futures come from Yahoo `=F` continuous contracts and indexes
from Yahoo `^`-symbols, both **explicitly labeled DELAYED ~15m** via the 11.2
freshness contract, and every future is paired with a real-time ETF proxy
quoted on Alpaca IEX (ES→SPY, NQ→QQQ, GC→GLD, CL→USO, ZN→IEF, ZB→TLT,
6E→FXE — table in `src/lib/instruments/proxies.ts`). The UI renders both.
Honesty is a product feature: freshness badges everywhere, never implied
real-time.

**Why:** The only free real-time alternative is proxies; the only accurate
futures levels are delayed. Showing both beats pretending either is complete.

**Consequences:** Yahoo is unofficial and brittle — mitigated by the
stale-shadow cache (24h) + quality-gate confidence + proxy redundancy. If a
real futures data budget ever appears (Databento etc.), swap `futures.ts`
internals; consumers only see `MarketQuote`. Also fixed here: Yahoo's `^DXY`
is dead (price=None since 2019) — dollar index must be `DX-Y.NYB`; the old
intermarket `dxy` field had been silently null.

---

## 2026-07-05 — LLM chain: Cerebras-first, SambaNova removed, explicit priority

**Context:** API-stack audit (Phase 11.9). Groq free tier = ~1K req/day;
Cerebras = 1M tokens/day (most generous renewable). SambaNova's "free tier"
is a one-time $5 credit, its key was deployed but had no `callProvider` case,
and the OpenRouter key was never deployed (silent 401 per fallback pass,
fixed in 11.1).

**Decision:** `ModelSpec` gains an explicit `priority` field (declaration
order was the implicit contract — fragile). Order: cerebras-70b → groq-70b →
groq-8b → cerebras-qwen-32b → openrouter-deepseek-r1. SambaNova removed from
`ProviderName`, the whitelist, and the voice route's direct call.

**Consequences:** Full audit table lives in `domain/api-budgets.md`. User
deletes `SAMBANOVA_API_KEY` from Vercel. If SambaNova ever ships a renewable
free tier, re-add as a provider with a `callProvider` case this time.
