# Phase 9 — Feedback loops + UX polish

## Goal

Close the feedback loops the system already has data for: source reliability
should auto-update from allocation outcomes; watchlist should auto-promote
high-quality symbols. Plus deferred UX polish.

## Step log

### 9.1 — Per-strategy performance breakdown (branch `phase-9.1/per-strategy-performance`)

`/api/performance` now joins `trades` → `attribution` and rolls a
per-strategy section: trades, wins, win %, weighted P&L (P&L × attribution
contribution_pct), avg R. `/performance` page renders a BY STRATEGY table
under the equity curve. Defaults gracefully when attribution table is empty.

### 9.2 — Source reliability feedback loop (branch `phase-9.2/source-reliability-feedback`)

Closes the learning loop:

- `src/lib/learning/source-reliability.ts`:
  - `recomputeSourceReliability(days)` joins trades → allocations → opportunities
    to compute per-source `avg_r`, `fill_rate`, `sample_size`, `reliability_score`
  - Score formula: 0.7 × tanh(avg_r)+1 / 2 + 0.3 × fill_rate (neutral 0.5 when < 5 samples)
  - Writes to `source_reliability` table (upsert per source)
- `src/lib/learning/source-reliability.test.ts` — 5 unit tests on the score
  formula (sample-size discount, R sign, fill-rate weight, clamping)
- `GET /api/sync/source-reliability` cron (CRON_SECRET)
- Cron: `0 22 * * *` (daily at 10pm UTC)
- `src/lib/allocator/scorer.ts` `buildPlan` takes an optional `reliabilityByName`
  map and multiplies each opportunity's score by its source reliability.
  Defaults to 1.0 so existing tests pass unchanged.

Closes the feedback loop: opportunities → executions → trade outcomes →
reliability scores → future allocator weighting.

### 9.4 — Allocator UI sort + filter (branch `phase-9.4/allocator-ui-filters`)

(Was deferred 8.4 — picked up now.)

- Sort pills: score / risk / size (descending)
- Source filter pills (auto-populated from current plan)
- "Hide blocked" toggle (filters to approved rows only)
- "Showing N of M" counter

### 9.5 — /memories search + tag filter (branch `phase-9.5/memories-search`)

- Free-text search box (matches against memory content, case-insensitive)
- Auto-populated tag pills from current memory set (top 12 + count of extras)
- Click a tag → filter to just that tag (single-tag mode with ×-to-clear)
- Combines with existing type filter

Phase 9 nearly done. 51 PRs in stack. Watchlist intelligence (9.3) the
only remaining queued item.