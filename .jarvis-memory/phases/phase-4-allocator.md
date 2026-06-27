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

### 4.2 — Kelly-capped sizer (branch `phase-4.2/sizer`)

`src/lib/allocator/sizer.ts` exports:

- `kellyFraction(winProb, expectedR)` — pure Kelly criterion math, clipped
  to [0, ∞). Returns 0 for negative-edge bets.
- `sizeOpportunity(opp, equity, config)` — returns `SizingResult` with size,
  dollar_amount, dollar_risk, kelly_fraction, risk_pct_of_equity.
- Two caps applied; the smaller wins:
  1. Risk cap: `equity × max_risk_per_trade_pct ÷ per_share_risk`
  2. Kelly cap: `equity × kelly_fraction × kelly_fraction_cap ÷ entry`
- Guard rails: rejects missing entry/stop, zero stop distance, non-positive
  equity, computed-zero-size.

12 unit tests in `src/lib/allocator/sizer.test.ts` covering math + edges.

### 4.3 — Portfolio scorer (branch `phase-4.3/scorer`)

`src/lib/allocator/scorer.ts` exports `buildPlan(opps, positions, equity, config)`
returning `AllocatorPlan { equity, rows[], approved_count, total_dollar_at_risk }`.

Scoring: `expected_r × win_prob × confidence` (missing values default to 1/0.5/0.5
respectively). Higher scores get capacity first.

Filters applied per-row in priority order:
- missing entry/stop → `missing_data`
- sizer returns zero → `size_zero`
- `max_open_positions` reached → `risk_blocked`
- already holding instrument → `risk_blocked`
- asset class % cap exceeded → `risk_blocked`

6 unit tests in `src/lib/allocator/scorer.test.ts` covering rank order, all
three cap types, and the running totals.

45 total tests passing.

### 4.4 — Allocator dry-run endpoint (branch `phase-4.4/allocator-dryrun`)

`POST /api/allocator/run` (CRON_SECRET-protected). Reads open opportunities,
live positions + equity from AlpacaAdapter, current risk_config, and returns
the AllocatorPlan. Does NOT execute anything — that lands in 4.6.

Verification after deploy:
```
curl -X POST $URL/api/allocator/run \
  -H "Authorization: Bearer $CRON_SECRET"
# → { ok: true, generated_at, plan: { equity, rows[], approved_count, total_dollar_at_risk } }
```

### 4.5 — Allocator UI (branch `phase-4.5/allocator-ui`)

- Lifted CRON_SECRET auth on `/api/allocator/run` (read-only plan generation,
  parity with other dashboard endpoints). Execute endpoint will keep strict
  auth when it lands.
- `/allocator` page with "Run Plan" / "Refresh Plan" button, summary line
  (equity, approved/total, $ at risk, generated time), and a per-row table
  showing source, symbol, side, score, size, $ amount, $ risk, risk %,
  Kelly fraction, status badge, and block reason.
- Sidebar: added ALLOCATOR link to EXECUTION group.

### 4.6 — Allocator execute endpoint (branch `phase-4.6/allocator-execute`)

- `src/lib/allocator/allocations.ts`: `allocations` table + recordAllocation /
  listAllocations helpers. Tracks every execution attempt for audit.
- `src/app/api/allocator/execute/route.ts`:
  - POST with CRON_SECRET (the dangerous endpoint)
  - Body: `{ approved_ids: string[], decided_by?: "user"|"auto"|"council" }`
  - Rebuilds the plan against LIVE state before executing — any opportunity
    no longer approved gets skipped (risk caps may have shifted)
  - Dispatches through the right BrokerAdapter (`getAdapter(opp.asset_class)`)
  - Uses `client_order_id = "opp_<id>"` for broker-side idempotency
  - On success: marks opportunity `executed`, records `allocations` row,
    audit_log entry
  - Returns per-id results
- 50-id batch cap so a single call can't drown the broker

Verification (against paper account):
```
curl -X POST $URL/api/allocator/execute \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"approved_ids":["opp_xxx_yyy"]}'
# → { ok, requested, executed, skipped, errored, results: [...] }
```

Next: 4.7 Risk Manager veto.