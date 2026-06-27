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

Next: 2.2 wraps `ingestOpportunity` in a POST endpoint with bearer auth.