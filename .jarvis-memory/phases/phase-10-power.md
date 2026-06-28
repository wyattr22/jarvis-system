# Phase 10 — Test gaps + power UI

## Goal

Close the test coverage gap on sandbox/quality.ts (was deferred 8.2),
add drill-down dashboards (symbol detail, agent-log filter), and expose
the council via MCP so chat clients can trigger cycles.

## Step log

### 10.1 — sandbox/quality unit tests (branch `phase-10.1/sandbox-quality-tests`)

Closes the 8.2 gap. Pure-function tests for the confidence-score math:
- `scoreConfidence` returns 0 on validation fail
- Fresh + passing source → ~0.85 (validated math)
- Freshness decays linearly
- Output clamped to [0, 1]
- `passRate` returns neutral 0.5 for unknown sources
- `recordOutcome` updates track record correctly
- 100-entry circular buffer cap enforced

Exported `_testHelpers` from `quality.ts` so tests can poke at the
private helpers without spinning up a DB. Comment explicitly marks it
test-only.

### 10.2 — Symbol detail page (branch `phase-10.2/symbol-detail-page`)

`/symbol/[ticker]` drill-down with parallel fetches:
- Live position (if any)
- KPI tiles: open opps, allocations, signals, memories, trade stats, P&L
- Opportunities, allocations, memories sections with rows
- Chart link → `/charts?symbol=X`

Backend: `GET /api/symbol/[ticker]` runs 6 parallel queries (opps,
allocs, signals, memories, trades, live position). Validates ticker regex.

Useful for "show me everything about TSLA" in one page.

Next: 10.3 council.run MCP tool.