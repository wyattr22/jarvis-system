# Phase 5 — Voice + Council See Everything

## Goal

Jarvis's voice route + Council agents reason over the unified opportunities
feed, not just legacy signals. When asked "what's the best opportunity right
now" he answers from the feed; when the council runs, the Observer ingests
opportunities alongside trades.

## Step log

### 5.1 — Voice context injects opportunities (branch `phase-5.1/voice-opportunities`)

`src/lib/learning/opportunities-summary.ts` exports `getOpportunitiesContextLine()`:
- Pulls last 50 open opportunities
- Filters to confidence ≥ 0.5
- Ranks by `expected_r × win_prob × confidence`
- Returns top 3 as a single context line:
  `OPEN OPPORTUNITIES (12 total, top 3 by score): splitwatch:ATHE long expR=1.2 win=45% score=0.27 | swing:TSLA long expR=2.5 win=55% score=0.79 | ...`

Wired into `src/app/api/voice/route.ts` Promise.all alongside the existing
context/memories/research/setupStats fetches, then injected into the system
prompt (skipped for casual / navOnly modes to keep them cheap).

### 5.2 — Voice nav for opportunities/allocator/sources (branch `phase-5.2/voice-intent-opportunities`)

Added page nav entries to `PAGE_MAP` in `src/app/api/voice/route.ts`:
- `opportunities`, `opportunity`, `opp feed` → `/opportunities`
- `allocator`, `allocate`, `allocation`, `risk plan` → `/allocator`
- `sources`, `source quality`, `quality gate` → `/source-quality`

Now "open the allocator", "show me opportunities", "go to sources" all
route correctly. The reasoning side (Jarvis explaining a specific
opportunity in voice) already works because 5.1 injects the top-3 list
into the system prompt.

Tool-calling from voice mid-response (e.g. Jarvis dynamically calling
`allocator.execute(id)`) is a bigger refactor — deferred to a Phase 6
ticket since the LLM router would need MCP-aware tool-use schema.

### 5.3 — Council sees opportunities feed (branch `phase-5.3/observer-opportunities`)

Built `src/lib/agents/opportunities-context.ts` exporting
`getOpportunitiesForCouncil()` which returns:
- `total_open` count
- `by_source` + `by_asset_class` distribution
- `top` — 5 highest-confidence ranked opportunities with full details

Wired into `runFullCouncilCycle()` orchestrator after the Observer step.
Snapshot logged to audit_log under `opportunities_snapshot` so we can
correlate council outcomes with the opportunity-feed state at decision time.

The Researcher + Critics don't change shape yet — that's a Phase 6 ticket
when we let proposals reference cross-project opportunity patterns.

### 5.4 — Opportunity expiry cron (branch `phase-5.4/opportunity-expiry`)

- `GET /api/opportunities/expire` (CRON_SECRET-protected) calls
  `expireOpportunities()` which marks any open row past `expires_at` as expired.
- Added to `vercel.json` cron at `0 6 * * *` (6am UTC daily).

Phase 5 complete. Jarvis sees opportunities in voice + council, can navigate
to /opportunities + /allocator + /source-quality by voice, the orchestrator
logs cross-project snapshots into audit_log, and stale opportunities expire
automatically.

Next:
- Phase 0a.6 — enable branch protection on main (manual UI)
- Phase 1.7 — Claude Desktop smoke test (post-deploy)
- Phase 6 (not yet planned) — LLM-driven dynamic tool calling, real
  futures/forex providers, cross-asset alpha