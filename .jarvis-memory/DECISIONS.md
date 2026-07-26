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

## 2026-07-25 — Phase 21: knowledge-graph brain, structural extraction only (LLM layer deferred)

**Context:** No relationship view existed over anything Jarvis has done —
`/memories` is a flat list, research notes are just table rows, nothing is
connected. Wanted an Obsidian-like "second brain": an in-app graph plus a
real exportable vault.

**Decision:** `kg_nodes`/`kg_edges` (lazy-created, `src/lib/knowledge-graph/
store.ts`), populated by `runStructuralSync()` — every FK relationship
already in the schema (`signals.strategy_id`, `trades.signal_id`,
`proposals.strategy_id`, `experiments.proposal_id`) becomes an edge via
plain SQL, symbols become nodes automatically. **Zero LLM calls, zero
hallucination risk.** `/api/brain/sync` (daily cron, same `CRON_SECRET`
pattern as every other job) triggers it incrementally via
`kg_sync_state.last_synced_at`. `/brain` page: `react-force-graph-2d` (new
dependency — canvas-based, no hand-rolled d3-force needed) in a
`next/dynamic({ssr:false})` wrapper since it touches canvas, colored by
`node_type` against the app's existing semantic palette, click-through to
each entity's real page rather than duplicating detail views.
`/api/brain/export` builds an Obsidian-compatible vault (`jszip`, new
dependency) entirely in memory — one `.md` file per node with frontmatter +
a `[[Wikilink]]` `## Links` section from edges — and streams it as a
download. Explicitly a one-shot snapshot, not a live-synced vault: Vercel
has no persistent filesystem to keep one on the server side.

**LLM-based extraction over free text (research_notes/daily_digests/
jarvis_memory) was deliberately deferred, not silently dropped.** The
structural layer alone is already a genuinely useful "what has Jarvis done
and why" graph with no cost or accuracy risk; adding an LLM extraction pass
means real prompt/quota tuning (which cheap-tier model, what few-shot
examples keep entity extraction from hallucinating relationships) that's
better done as its own follow-up once the structural layer has been lived
with for a bit, not bundled into the same PR as the schema/UI/export
groundwork.

**Verification (live, not just unit-tested):** ran the real sync against
the actual dev Turso database during this PR (not a mock) — found 12 nodes
/ 10 edges from genuine prior council proposals and the `smc-ict-v4`
strategy row. Downloaded the resulting export, confirmed real,
correctly-deduplicated markdown files with working frontmatter. This is
purely additive (3 new tables, read-only SELECTs against existing ones) —
nothing pre-existing was modified — but it does mean **real derived data
now exists in `kg_nodes`/`kg_edges` in the live dev database** from this
verification run, flagged here rather than left as a surprise.

**Consequences:** pnpm's local store needed relinking before `pnpm add`
would work in this environment (`ERR_PNPM_UNEXPECTED_STORE` — a pre-existing
node_modules/store version mismatch, unrelated to this phase) — resolved
with a plain `pnpm install` before adding the two new dependencies; no
version drift resulted (`pnpm-lock.yaml` diff was purely additive). Also hit
a stale-`.next`-directory issue where `next dev` 404'd on *every* route
(not just the new ones) after a preceding `next build` — clearing `.next`
fixed it; worth remembering if a future session sees the same symptom.

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
