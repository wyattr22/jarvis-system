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

Next: 9.2 source reliability outcomes feedback.