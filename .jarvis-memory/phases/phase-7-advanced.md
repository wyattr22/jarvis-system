# Phase 7 — Advanced features + operability

## Goal

Visibility (system-status), reactive alerting (push notifications), better
operator UX (README, correlation widget), and the deferred LLM-driven
dynamic tool-calling from Phase 6.

## Step log

### 7.1 — /system-status dashboard (branch `phase-7.1/system-status-dashboard`)

Single-page health check at `/system-status`. Refreshes every 30s.

- `GET /api/system-status` aggregates:
  - Cron health (per-cron last-run timestamp vs expected interval → ok/warn/down/unknown)
  - Source quality summary (total vs quarantined)
  - MCP clients (total + active 24h)
  - Allocations (today, filled 7d)
  - Opportunities by status
  - Drawdown alerts 24h (warn + danger counts)
- Page renders 6 KPI tiles + cron table + opportunities breakdown.
- Sidebar: STATUS link added.

### 7.2 — Push notifications wiring (branch `phase-7.2/push-notifications`)

Wired existing `sendPushToAll` into:
- `drawdown-check` cron: pushes only on `danger` severity (warn stays dashboard-visible)
- `allocator/execute`: pushes when Risk Manager vetoes a plan

Both calls best-effort `.catch` so silent VAPID failures don't break crons/execution.

### 7.3 — README rewrite (branch `phase-7.3/readme-expansion`)

Replaced create-next-app boilerplate with a proper project README:
7-layer overview, quick start, env vars table, all 20 dashboard pages,
all 11 cron jobs, MCP setup recipe, architecture, dev workflow, and
phase shipped status.

### 7.4 — Source correlation widget (branch `phase-7.4/source-correlation`)

- `src/lib/learning/source-correlation.ts`:
  - `getSourcePerformance(daysBack)` rolls allocations by source
    (total executed / filled / rejected / avg $ allocated)
  - `getInstrumentAgreement(daysBack)` finds instruments multiple sources
    independently flagged in a 7d window — agreement = quality signal
- `GET /api/source-performance?days=30&agreement_days=7` exposes both

Council can later weight sources by their execution track record; UI
chip showing cross-source agreement can land in a follow-up.

Phase 7 progress: 4/4 in-scope steps complete. 43+ PRs in stack.