# Phase 2 — Onboard splitwatch + swing_scanner

## Goal

External projects (splitwatch, swing_scanner) push their detected setups
into Jarvis's unified `opportunities` table. Jarvis exposes them via MCP
tools so any client (council, voice, Claude Desktop) can reason across
sources. Lays the groundwork for the Phase 4 allocator.

## Step log

### 2.1 — Opportunities store (branch `phase-2.1/opportunities-store`)

Created `src/lib/opportunities/store.ts` with:

- `opportunities` table schema (id, source, asset_class, instrument, side,
  thesis, expected_r, win_prob, horizon_days, entry_hint, stop_hint,
  size_hint, confidence, expires_at, status, source_payload_json, timestamps)
- Indexes on source, status+created_at, instrument
- `ingestOpportunity(input)` — inserts a new opp, OR refreshes an existing
  open opp from the same (source, instrument, side) within 24h when the
  entry_hint is within 1% drift. Returns `{ id, dedup }`.
- `listOpportunities(filters)` — source/status/asset_class/instrument
  filters + limit (max 500).
- `updateOpportunityStatus(id, status)` — for approve/reject/mute flows.
- `expireOpportunities()` — flips `open` rows past their `expires_at` to
  `expired`. Cron-friendly.

Tests in `src/lib/opportunities/store.test.ts` cover the `OpportunityInput`
shape. DB-backed flows are covered in Phase 4 integration tests.

### 2.2 — Ingest endpoint (branch `phase-2.2/opportunities-ingest`)

`POST /api/opportunities/ingest` accepts an OpportunityInput, validated by
a zod schema. Auth = bearer token via `authenticateRequest`, requires
`write:opportunities` scope (or CRON_SECRET wildcard).

Sample push from splitwatch (after they register a token):
```bash
curl -X POST https://jarvis-system-flame.vercel.app/api/opportunities/ingest \
  -H "Authorization: Bearer $SPLITWATCH_JARVIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "splitwatch",
    "asset_class": "equity",
    "instrument": "ATHE",
    "side": "long",
    "thesis": "Reverse split 1:5 effective 2026-07-01; fractional rounding-up arbitrage",
    "expected_r": 1.2,
    "win_prob": 0.45,
    "horizon_days": 3,
    "entry_hint": 4.20,
    "stop_hint": 3.95,
    "expires_at": 1782800000000,
    "source_payload": {"cik": "0001234", "ratio": "1:5"}
  }'
```

Returns: `{ ok: true, id: "opp_…", dedup: false, client: "mcp_…" }`

### 2.3 — Opportunities dashboard (branch `phase-2.3/opportunities-dashboard`)

- `GET /api/opportunities` — read-only, no auth. Filters: source, status,
  asset_class, instrument, limit.
- `/opportunities` page — full table with source + status filter pills,
  20s auto-refresh, color-coded source/status badges, tabular numerics,
  expected R / win% / horizon / entry / stop / confidence / age columns.
- Sidebar: added OPPORTUNITIES link to the EXECUTION group.

Read-only first; approve/reject/mute actions land in 2.8.

### 2.4 — splitwatch tool (branch `phase-2.4/splitwatch-tool`)

`src/lib/mcp/tools/splitwatch.ts` registers `splitwatch.list_opportunities`
(scope `read:opportunities`) which queries the unified opportunities table
filtered to `source='splitwatch'`.

splitwatch's deployed URL is TBD — the `*.vercel.app` wildcard in the
sandbox whitelist already covers any future Vercel deployment, so no host
whitelist change is needed yet. When splitwatch deploys, the cross-repo
proxy tool (`splitwatch.get_filing`) can land in a follow-up PR.

**splitwatch is currently a local-only project** (not yet a git repo at
`/Users/wyattrantz/splitwatch/`). For step 2.5 the user needs to:

1. `cd /Users/wyattrantz/splitwatch`
2. `git init && gh repo create wyattr22/splitwatch --private --source=. --push`
3. Add a Vercel project + env vars (Anthropic key, DB url, etc.)
4. Register the splitwatch MCP client:
   ```bash
   curl -X POST https://jarvis-system-flame.vercel.app/api/admin/mcp-clients \
     -H "Authorization: Bearer $CRON_SECRET" \
     -d '{"name":"splitwatch","scopes":["write:opportunities"]}'
   ```
5. Set `JARVIS_INGEST_URL` + `JARVIS_INGEST_TOKEN` env vars in Vercel
6. Add a `pushToJarvis()` helper in splitwatch's scan flow that POSTs to
   `/api/opportunities/ingest` for every detected split

### 2.6 — swing tool (branch `phase-2.6/swing-tool`)

`src/lib/mcp/tools/swing.ts` registers `swing.list_setups` (scope
`read:opportunities`) — same pattern as splitwatch, filtered to
`source='swing'`.

There are two swing-related projects locally:
- `/Users/wyattrantz/swing_scanner/` — Python script (swing_scanner.py)
- `/Users/wyattrantz/swing-research/` — Node project with api/ and vercel.json

For step 2.7 the user picks which one (or both) to wire up — same recipe
as splitwatch:

1. If not a git repo, init + create GitHub repo
2. Deploy to Vercel (swing-research already has vercel.json — easier)
3. Register the swing MCP client:
   ```bash
   curl -X POST https://jarvis-system-flame.vercel.app/api/admin/mcp-clients \
     -H "Authorization: Bearer $CRON_SECRET" \
     -d '{"name":"swing","scopes":["write:opportunities"]}'
   ```
4. Set JARVIS_INGEST_URL + JARVIS_INGEST_TOKEN env vars
5. Add a push helper that POSTs detected setups to `/api/opportunities/ingest`
   with `source: 'swing'`

Next: 2.8 approve/reject/mute UI on the opportunities page.