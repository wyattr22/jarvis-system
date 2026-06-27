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

Next: 2.4 splitwatch host whitelist + `splitwatch.list_opportunities` MCP tool.