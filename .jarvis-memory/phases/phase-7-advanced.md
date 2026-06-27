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

Next: 7.2 push notifications.