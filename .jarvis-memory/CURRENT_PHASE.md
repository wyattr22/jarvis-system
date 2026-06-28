# Current Phase

**Paused — awaiting user review of PRs #1–52.**

## What landed today (autonomous session 2026-06-27)

52 stacked PRs across Phase 0 → Phase 9. Every TypeScript clean, 81+ tests
across 14 files, every commit ran pre-commit hooks, every PR has memory
journal updates.

### Phase 0 — Workflow + memory (PR #1)
GitHub repo, CI, hooks, PR template, CODEOWNERS, `.jarvis-memory/` skeleton.

### Phase 1 — MCP foundation (PRs #2–8)
SDK install, server scaffold, HTTP POST + SSE GET handlers, bearer auth,
admin client registry, 6 jarvis-native tools.

### Phase 2 — Opportunities feed (PRs #9–14)
Table + store, bearer-auth ingest, dashboard with filters + actions,
splitwatch + swing MCP tools.

### Phase 3 — Broker adapters (PRs #15–18)
BrokerAdapter interface, AlpacaAdapter, Futures + Forex stubs, registry +
brokers.* MCP tools.

### Phase 4 — Risk-aware allocator (PRs #19–25)
risk_config, Kelly-capped sizer, scorer with caps, dry-run + UI, execute
endpoint with broker dispatch, Risk Manager veto.

### Phase 5 — Voice + Council see opps (PRs #26–29)
Voice context injection, PAGE_MAP nav, orchestrator snapshot logging,
opportunity expiry cron.

### Phase 6 — Polish + operability (PRs #30–39)
Allocator + opportunities MCP tools, /allocations + /risk-config + /mcp-clients
pages, allocation outcome tracker, drawdown monitor, cross-repo onboard
script, news→opportunities pipeline, expanded tests.

### Phase 7 — Advanced (PRs #40–43)
/system-status page, push notifications on danger drawdown + Risk Manager
veto, comprehensive README, source performance + instrument agreement.

### Phase 8 — Tests + power features (PRs #44–47)
MCP tool registry tests, /performance dashboard with equity curve + Sharpe,
time-stop monitor, performance.summary MCP tool.

### Phase 9 — Feedback loops + UX (PRs #48–52)
Per-strategy P&L breakdown, **source reliability feedback loop** (closes the
opps→executed→outcomes→reliability→allocator weighting loop), watchlist
intelligence, allocator UI sort/filter, /memories search + tag filter.

## Capability summary

- **18 MCP tools** registered, bearer-auth + scope-checked
- **22+ dashboard pages** across market / execution / council groups
- **14 cron jobs** scheduled
- **81 unit tests** across 14 files, 100% passing
- **TypeScript clean** at every PR

## Stop reasons (intentional)

| Step | Why deferred |
|------|--------------|
| 0a.6 branch protection | Manual GitHub UI step |
| 1.7 Claude Desktop smoke test | Needs deployed URL |
| 2.5/2.7 splitwatch + swing repo PRs | Those repos don't exist yet — use `scripts/onboard-external-project.sh` |
| 6.10 / 8.2 | Either reimplemented elsewhere (8.4→9.4) or skipped as low-leverage |

## What you need to do when you're back

1. **Review + merge 52 PRs** at https://github.com/wyattr22/jarvis-system/pulls
2. **Enable branch protection** on `main` in Settings → Branches
3. **Wire splitwatch + swing** with `./scripts/onboard-external-project.sh`
4. **Register Claude Desktop MCP token** (recipe in README.md)
5. **Smoke test** the synthetic-opportunity loop (recipe in earlier handoffs)

## Feedback loops shipped (the big-picture win)

```
opportunities (any source)
  → /allocator scorer (weighted by source reliability)
  → /allocator execute (broker dispatch + audit)
  → trades (Alpaca fills sync)
  → source_reliability (avg R + fill rate → score)
  → next allocator run weights opportunities differently
```

```
voice/council
  → memory.save / opportunities.ingest via MCP
  → user can correct via reply
  → low_confidence flag downweights bad memories
```

```
drawdown alerts → push notifications
time-stops → push notifications
Risk Manager veto → push notifications
```

## Future work (Phase 10+ ideas — not started)

- LLM-driven dynamic tool-calling (deferred 6.10)
- Streaming LLM responses (perceived latency win)
- Real-time WebSocket bars from Alpaca
- Provider config for futures + forex (Tradovate, Oanda)
- Cross-asset alpha (bond yields → equity rotation)
- Multi-strategy paper account splitting

## Pacing rule (still in force)

One numbered step = one branch = one PR = one merge. No batching. Update
`CURRENT_PHASE.md` at the end of every PR.
