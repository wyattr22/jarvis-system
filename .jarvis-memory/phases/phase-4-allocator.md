# Phase 4 — Risk-Aware Allocator

## Goal

Single function that reads all open opportunities + current positions and
returns "here's how much of each you should take". Respects per-trade,
per-day, per-strategy, and per-asset-class risk caps. Always Kelly-fraction
capped so a single bet can't blow up the account.

## Step log

### 4.1 — Risk config (branch `phase-4.1/risk-config`)

`src/lib/allocator/risk-config.ts` defines the single-row `risk_config`
table (id=1) with these fields:

- `equity_override` (optional, for testing)
- `max_risk_per_trade_pct` — default 0.01 (1%)
- `max_daily_loss_pct` — default 0.03 (3%)
- `max_open_positions` — default 10
- `max_correlated_exposure_pct` — default 0.25
- `asset_class_caps` — equity 50%, crypto 10%, futures 30%, forex 10%,
  options 10%, prediction 5% (sums >100% on purpose — they're independent caps)
- `kelly_fraction_cap` — default 0.25 (quarter-Kelly)

API:
- `getRiskConfig()` — read; seeds defaults if empty
- `seedDefaults()` — admin reset
- `updateRiskConfig(patch)` — partial merge update

`/api/admin/risk-config`:
- `GET` (open) — current config
- `POST { action: "seed" }` (CRON_SECRET) — reset to defaults
- `POST <patch>` (CRON_SECRET) — partial update

Next: 4.2 Kelly-capped sizer.