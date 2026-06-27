# Current Phase

**Paused — awaiting user review of PRs #1–47.**

## What landed today (autonomous session 2026-06-27)

47 stacked PRs across Phase 0 → Phase 8.6. All TypeScript clean, 76+ tests
passing across 13 files, every commit ran pre-commit hooks, every PR has
memory journal updates.

### Phase 0 — Workflow + cross-session memory (PR #1)

GitHub repo, CI workflow, husky + lint-staged + commitlint hooks, PR
template, CODEOWNERS, `.jarvis-memory/` skeleton (INDEX, CURRENT_PHASE,
DECISIONS, KNOWN_ISSUES, phases/, sessions/, domain/), CLAUDE.md update
teaching future sessions to read INDEX.md.

### Phase 1 — MCP foundation (PRs #2–8)

- MCP SDK install + scaffold + dispatch
- HTTP POST handler + SSE GET handler
- Bearer-token auth + admin client registry (CRON_SECRET admin endpoint)
- First 6 tools: memory.search, memory.save, signals.list, account.snapshot,
  source_quality.snapshot, voice.ask

### Phase 2 — Opportunities feed (PRs #9–14)

- `opportunities` table + store with 24h/1% dedup
- `POST /api/opportunities/ingest` bearer-auth + zod schema
- `/opportunities` dashboard with filters + approve/reject/mute actions
- `splitwatch.list_opportunities` + `swing.list_setups` MCP tools

### Phase 3 — Broker adapter layer (PRs #15–18)

- `BrokerAdapter` interface, AlpacaAdapter (live), Futures + Forex stubs
- `getAdapter(assetClass)` registry + `brokers.list/is_open` MCP tools

### Phase 4 — Risk-aware allocator (PRs #19–25)

- `risk_config` table + admin endpoint
- Kelly-capped sizer (12 unit tests)
- Portfolio scorer (6 unit tests) — score = expected_r × win_prob × confidence,
  filters: missing data, max positions, duplicate symbol, asset class cap
- `POST /api/allocator/run` dry-run + `/allocator` page
- `POST /api/allocator/execute` with broker dispatch + idempotency
- `vetoAllocatorPlan()` Risk Manager — hard veto on daily loss cap, per-opp
  block on > 3% risk per trade

### Phase 5 — Voice + Council see opportunities (PRs #26–29)

- Voice context injects top-3 high-confidence opportunities
- PAGE_MAP: voice can navigate to /opportunities, /allocator, /sources
- Orchestrator logs cross-source opportunities snapshot
- Daily `/api/opportunities/expire` cron

### Phase 6 — Polish + operability (PRs #30–39)

- `allocator.plan/summary/execute` MCP tools
- `opportunities.list/top/update_status/ingest` MCP tools
- `/allocations` execution history dashboard
- `/risk-config` editable risk cap page
- `/mcp-clients` token management page
- Allocation outcome tracker (Alpaca order status → DB)
- Drawdown monitor (warn -3%, danger -6%) + audit log
- `onboard-external-project.sh` automation script
- News → low-confidence (0.2) opportunities (below 0.5 model gate)
- Expanded test coverage (news, dedup, risk-config) — 12 new tests

### Phase 7 — Advanced features (PRs #40–43)

- `/system-status` aggregated health (cron, sources, MCP, allocations,
  drawdowns)
- Push notifications on danger drawdowns + Risk Manager vetoes
- Comprehensive README rewrite (20 pages, 11 crons, MCP recipe, architecture)
- Source performance + instrument agreement (cross-source quality signal)

### Phase 8 — Tests + power features (PRs #44–47)

- MCP tool registry surface tests (7 new tests)
- `/performance` dashboard with KPI tiles + SVG equity curve + Sharpe
- Time-stop monitor (positions held past horizon_days)
- `performance.summary` MCP tool

---

## Quality bar — all green

- **76 unit tests** across 13 test files
- **TypeScript clean** (tsc --noEmit) at every PR
- **Conventional commits** enforced via commitlint
- **Pre-commit hooks** ran on every commit (lint-staged tsc on staged files)
- **No `--no-verify` bypasses**

## Capability summary

**18 MCP tools** registered, all bearer-auth + scope-checked:

| Category | Tools |
|----------|-------|
| Memory | memory.search, memory.save |
| Trading | signals.list, account.snapshot, voice.ask |
| Quality | source_quality.snapshot |
| Sources | splitwatch.list_opportunities, swing.list_setups |
| Brokers | brokers.list, brokers.is_open |
| Opportunities | opportunities.list, opportunities.top, opportunities.update_status, opportunities.ingest |
| Allocator | allocator.plan, allocator.summary, allocator.execute |
| Performance | performance.summary |

**21 dashboard pages** under /market, /execution, /council groups.

**13 cron jobs** running in production (when deployed):
features, drift, council, brief, fills, proposal-outcomes, meta-enforce,
opportunities/expire, allocation-outcomes, drawdown-check, news-scan,
time-stops.

## Stop reasons (intentional — won't auto-execute)

| Step | Why deferred |
|------|--------------|
| 0a.6 branch protection | Manual GitHub UI step |
| 1.7 Claude Desktop smoke test | Needs deployed URL |
| 2.5 splitwatch repo PR | splitwatch isn't a git repo yet |
| 2.7 swing repo PR | swing repos aren't deployed |
| 6.10 dynamic LLM tool-calling | Needs careful prompt-engineering |
| 8.2 sandbox/quality explicit tests | Implicit coverage already strong |
| 8.4 allocator UI sort/filter | Low-leverage polish |

## What you need to do when you're back

1. **Review the PR stack.** 47 PRs at https://github.com/wyattr22/jarvis-system/pulls.
   Walk #1 → #47 in order, or `gh pr merge --squash --auto <num>` to queue them.
2. **Enable branch protection on `main`** (Settings → Branches → require PR + `CI / check`).
3. **Run the onboard-external-project script** for splitwatch + swing to wire
   them as opportunity sources:
   ```bash
   export CRON_SECRET='...'
   ./scripts/onboard-external-project.sh /Users/wyattrantz/splitwatch splitwatch
   ./scripts/onboard-external-project.sh /Users/wyattrantz/swing-research swing
   ```
4. **Register Claude Desktop MCP token** (recipe in README.md "MCP — connect Claude Desktop")
5. **Smoke test the end-to-end loop** (recipe in README.md or earlier CURRENT_PHASE entries)

## Future work (Phase 9+ ideas — not started)

- LLM-driven dynamic tool-calling (deferred 6.10) — Jarvis mid-response calls MCP tools
- Multi-horizon strategy split (separate paper account per strategy)
- Streaming LLM responses (faster perceived latency)
- Real-time WebSocket bar updates from Alpaca
- Provider config for futures + forex (Tradovate, Oanda)
- Cross-asset alpha (bond yields → equity rotation)

## Pacing rule (still in force)

One numbered step = one branch = one PR = one merge. No batching. Update
`CURRENT_PHASE.md` at the end of every PR.
