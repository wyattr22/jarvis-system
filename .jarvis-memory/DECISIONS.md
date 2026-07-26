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

## 2026-07-25 — Phase 16: rule engine as the one execution path, not a second system

**Context:** `checkBotSignal`/`StrategyParams` (`src/lib/backtest/bot-strategy.ts`)
is one hardcoded algorithm — "adjustable" only ever meant tuning numeric
thresholds on that one fixed set of confluence rules. Nothing (human or LLM)
could introduce genuinely new entry/exit logic. Needed a declarative format
so a strategy candidate can be authored and backtested in one request/response
cycle (decision, made earlier: declarative rules over sandboxed code, chosen
specifically for that instant-iteration requirement).

**Decision:** Extracted `bot-strategy.ts`'s indicator/detector math verbatim
into `src/lib/strategy-engine/indicators.ts` (byte-identical functions,
`bot-strategy.ts` now imports them instead of defining them locally — zero
behavior change). Built `StrategyDefinitionSchema` (zod) — a composable
condition tree (`gt`/`lt`/`and`/`or`/`not`/`count_at_least`/`true_when`) over
a fixed indicator vocabulary, plus a small fixed set of stop/target
*computation modes* (`pct`/`atr_multiple`/`structure` for stops;
`pct`/`r_multiple`/`dol_or_pct` for targets) rather than trying to make
every possible exit rule expressible as a boolean condition — deriving a
price isn't a yes/no question the way "is RSI above 40" is.
`SMC_ICT_V4_DEFINITION` expresses the existing legacy strategy as data using
this schema, and a parity test (`interpreter.test.ts`) proves
`evaluateStrategy()` matches `checkBotSignal(..., DEFAULT_PARAMS)` bar-for-bar
across 5 random synthetic price paths (bias/price/sl/tp/rr/dol/rsi/slDist and
tag arrays all compared exactly, plus a check that the test isn't vacuously
passing on all-null output).

**Why:** The interpreter is planned to become the *only* execution path
(Phase 17 wires it into the backtest + signal engine, replacing the direct
`checkBotSignal` calls) rather than living alongside the hardcoded version
forever — two permanent systems would mean every future indicator
improvement gets written twice. One nuance found while writing the parity
test: `revTags`/`contTags` are presentational confluence labels, not
decision-relevant outputs (the numeric fields are what drive P&L/order
placement) — the interpreter reproduces them by collecting which
`true_when` conditions fired specifically inside `count_at_least` groups
(not every passing filter), which is what makes `contTags` match legacy
exactly without hardcoding "reversal vs continuation" semantics into the
schema itself.

**Consequences:** A new indicator/detector requires adding one case to
`computeIndicator()` in `interpreter.ts` plus a schema variant, not touching
two separate implementations. The interpreter's `entry.biasSource` currently
only fully supports `daily_bias`/`both` (via the existing SMC daily-bias
engine) for anything that also wants `equilibrium`/`liquidity_raid`
indicators or a `dol_or_pct` target — `fixed_long`/`fixed_short` skip bias
computation entirely and those specific indicators/target mode return
false/are rejected gracefully rather than crashing, but a genuinely
non-SMC, non-daily-bias strategy family is more of a v2 concern.

---

## 2026-07-25 — Phase 17: interpreter dispatch avoids a manual production migration

**Context:** Phase 16 built the rule-engine interpreter and schema, unwired.
Phase 17 needed to make `strategyId` actually select behavior in the
backtest route and signal engine (both previously called `checkBotSignal`
directly, ignoring which strategy was asked for) without requiring anyone to
run a write against the live Turso production database by hand.

**Decision:** `strategy-engine/dispatch.ts`'s `getSignalForStrategy()`
resolves a strategy's `StrategyDefinition` from the `strategies.definition_json`
column (added via the same lazy `ALTER TABLE ... ADD COLUMN` + catch pattern
`ensureSemanticSchema()` already uses elsewhere in this repo — happens
automatically on first read in production, not a manual script). Critically,
when that column is null/missing specifically for `strategyId === "smc-ict-v4"`
(the one strategy that predates this whole system), dispatch resolves to
`SMC_ICT_V4_DEFINITION` **in memory** rather than requiring a backfill write
against the live row. Any strategy created from here on (Phase 20's
LLM-authored candidates included) writes real `definition_json` at insert
time, so this fallback only ever covers that one legacy row. Unknown/invalid
definitions fall back further to the raw `checkBotSignal(DEFAULT_PARAMS)`
call, never to "no signal at all."

The backtest route's existing ad-hoc `StrategyParams` override path (the
Strategy Builder UI, 12.6) is preserved exactly as-is — it only ever made
sense as "tune smc-ict-v4's own knobs," so `paramOverrides` still calls
`checkBotSignal` directly when present; `strategyId` dispatch only kicks in
when no override is given, which is also what Phase 20's candidate-testing
loop will use.

The signal engine now loops over every `strategies WHERE enabled = 1` row
(previously hardcoded to one `STRATEGY_ID` constant), each scanning its own
`definition_json.universe` — batch bar-fetches are cached per unique
universe within a sweep so strategies sharing `"active_scan_universe"` (the
common case) only fetch once.

**Why:** No code I wrote should need me (or anyone) to run a write against
the live production database as a manual step — the existing lazy-migration
convention already solves the schema half of that; the in-memory legacy
fallback solves the data half for the one row this system inherited rather
than created.

**Consequences:** A strategy whose `universe` is an explicit non-equity list
(e.g. future forex pairs) isn't wired to real bar-fetching yet —
`fetchBatchBars` in `signals/engine.ts` is Alpaca-equity-only, so those
symbols simply come back with zero bars and get skipped via the existing
insufficient-data check, same as any other data gap. Not a crash, just a
no-op until a broker-aware bar-fetch path exists for that asset class — a
real gap to close before a forex-targeting `StrategyDefinition` could ever
actually fire, flagged here rather than silently assumed to work.

---

## 2026-07-25 — Phase 15: OANDA forex adapter + per-asset-class market-hours gate

**Context:** Starting a multi-phase plan (Phases 15–21, full plan at
`/Users/wyattrantz/.claude/plans/lovely-snacking-glacier.md`) toward
self-authoring strategies, a multi-provider LLM router, OANDA forex
execution, and a knowledge-graph "brain." Phase 15 is the first, self-contained
step: forex had price data but zero execution — `ForexAdapterStub` threw on
every method, and `signalToOpportunity()` hardcoded `asset_class: "equity"`
regardless of the signal's real instrument, so the live execution pipeline
was 100% equity-only even though `getAdapter()` dispatch was already generic.

**Decision:** Implemented `OandaAdapter` against OANDA's v20 REST practice
API (per `forex.ts`'s own header comment naming it the recommended first
forex provider — zero credit card, matches every other free-tier choice in
this repo). Registry (`brokers/index.ts`) picks it when `OANDA_API_KEY` is
set, else falls back to the existing stub rather than crashing. Fixed
`signalToOpportunity()` to derive `asset_class` via the existing
`parseInstrument()` util instead of hardcoding it.

While fixing the hardcode, found and fixed a second problem in the same
function's caller: `runAutoCycle()`'s market-hours gate checked only
`equityAdapter.isOpen()` and aborted the **entire** cycle if equity was
closed — harmless before this PR (forex never got real opportunities to
abort), but would have silently starved forex trading outside the ~6.5h/day
US equity window once forex signals became possible. Changed the gate to
check `isOpen()` per asset class actually present in the day's opportunities
and filter per-class instead of a single global abort.

**Why:** OANDA over other forex candidates (FXCM deprecated, IBKR needs a
funded account) — matches the free-practice-tier bar every other provider in
this repo was picked against. Per-class market-hours gating over a shared
gate — forex trades ~24/5 while equity trades ~6.5h/day; a shared gate makes
the feature nominally exist but practically inert for forex.

**Consequences:** Equity/positions/day-P&L used for allocator sizing
(`buildPlan`) and the PDT guard still come from the equity adapter only —
OANDA's own equity and open positions aren't yet part of the shared capital
pool or cross-asset exposure tracking (pre-existing limitation, documented
inline in `scorer.ts` since before this PR — not introduced or fixed here).
Also, the equity-only PDT guard can still veto the *entire* cycle (including
forex, which isn't subject to PDT rules) when day-trades are high — an
over-conservative but fail-safe behavior, left as-is for this phase rather
than expanding scope into a cross-broker allocator redesign.

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
