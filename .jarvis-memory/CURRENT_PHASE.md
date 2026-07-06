# Current Phase

**Paused — awaiting user review of PRs #1–57.**

## Total shipped (autonomous sessions 2026-06-27 + 06-28)

57 stacked PRs across Phase 0 → Phase 10. Every TypeScript clean, 88+ tests
across 15 files passing, every commit ran pre-commit hooks, every PR
touched `.jarvis-memory/` for cross-session continuity.

### Phases 0–9 (PRs #1–52)
Detailed in earlier handoff (see git history). Workflow, MCP, opportunities,
brokers, allocator, voice/council, polish, tests, advanced, feedback loops.

### Phase 10 — Test gaps + power UI (PRs #53–57)
- **#53** sandbox/quality unit tests — closes the long-deferred 8.2 gap with 7 tests on the confidence-score math, passRate, circular buffer
- **#54** `/symbol/[ticker]` drill-down — single page aggregating opps + allocs + signals + memories + trades + live position for one ticker
- **#55** `council.run` + `council.recent` MCP tools — Claude clients can trigger a full council cycle via chat
- **#56** `/agent-log` search + filter — action substring + details text search + showing-N-of-M counter
- **#57** Half-hourly embeddings backfill cron — spreads the 12min admin call across hours so semantic search gradually warms up

## Capability summary (live state)

- **20 MCP tools** registered, bearer-auth + scope-checked
- **23 dashboard pages** across market / execution / council groups
- **15 cron jobs** scheduled in vercel.json
- **88 unit tests** across 15 files, 100% passing
- **TypeScript clean** at every PR
- **3 closed feedback loops:** opps→outcomes→reliability→allocator, voice→memory→correction, alerts→push

## Stop reasons (intentional)

| Step | Why deferred |
|------|--------------|
| 0a.6 branch protection | Manual GitHub UI step |
| 1.7 Claude Desktop smoke test | Needs deployed URL |
| 2.5/2.7 splitwatch + swing repo PRs | Those repos don't exist yet — use onboard script |
| 6.10 LLM dynamic tool-calling | Needs careful prompt engineering + design discussion |
| 8.4 | Picked up at 9.4 |

## What you need to do when you're back

1. **Review + merge 57 PRs** at https://github.com/wyattr22/jarvis-system/pulls
2. **Enable branch protection** on `main` in Settings → Branches → require PR + status checks
3. **Wire splitwatch + swing** with `./scripts/onboard-external-project.sh`
4. **Register Claude Desktop MCP token** (recipe in README.md)
5. **Smoke test** the synthetic-opportunity loop (recipe in README + earlier handoffs)

## Why I stopped here

After 57 PRs the remaining backlog (LLM dynamic tool-calling, streaming
responses, WebSocket real-time bars, futures/forex providers, multi-strategy
account splitting, cross-asset alpha) all need user input on direction —
either prompt-engineering judgment calls, account/provider choices, or
big refactors that benefit from discussion before code.

The operating surface is shipped. Smaller incremental polish would have
diminishing returns vs. the value of you reviewing what's there.

## Future work (Phase 11+ ideas — need user input first)

- **LLM-driven dynamic tool-calling** — Jarvis mid-response calls MCP tools.
  Needs LLM router with tool-use schema; pick approach (Groq function-calling,
  Claude-native, AI SDK)
- **Streaming LLM responses** — halve perceived voice latency.
  Affects voice route + client; needs streaming-aware TTS handoff
- **Real-time WebSocket bars** from Alpaca — replaces polling
- **Futures / forex broker wiring** — pick provider (Tradovate, Oanda) + add credentials
- **Multi-strategy paper account splitting** — separate equity per strategy
  via Alpaca sub-accounts
- **Cross-asset alpha** — bond yields → equity rotation; needs correlation
  matrix + factor model

## Pacing rule (still in force)

One numbered step = one branch = one PR = one merge. No batching. Update
`CURRENT_PHASE.md` at the end of every PR.
