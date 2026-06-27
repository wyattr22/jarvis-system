# Current Phase

**Active step:** 6.1 — allocator MCP tools (branch `phase-6.1/allocator-mcp-tools`)

Phase 6 = polish + operability. Building autonomously through the day.

## What's done

**28 stacked PRs covering Phase 0 → Phase 5.4.**

| PR  | Step  | What |
|-----|-------|------|
| #1  | 0     | Workflow + CI + hooks + memory system |
| #2  | 1.1   | Install @modelcontextprotocol/sdk |
| #3  | 1.2   | MCP server scaffold + 9 dispatch tests |
| #4  | 1.3   | MCP HTTP POST handler |
| #5  | 1.4   | Bearer auth + admin registry |
| #6  | 1.5   | SSE GET handler |
| #7  | 1.6   | memory.search, signals.list, account.snapshot |
| #8  | 1.8   | memory.save, source_quality.snapshot, voice.ask |
| #9  | 2.1   | opportunities table + store |
| #10 | 2.2   | Bearer-auth ingest endpoint |
| #11 | 2.3   | Opportunities dashboard + GET API |
| #12 | 2.4   | splitwatch.list_opportunities tool |
| #13 | 2.6   | swing.list_setups tool |
| #14 | 2.8   | Approve/reject/mute actions |
| #15 | 3.1   | BrokerAdapter interface |
| #16 | 3.2   | AlpacaAdapter |
| #17 | 3.3   | Futures + forex stubs |
| #18 | 3.4   | Adapter registry + brokers.* MCP tools |
| #19 | 4.1   | risk_config table |
| #20 | 4.2   | Kelly-capped sizer (12 tests) |
| #21 | 4.3   | Portfolio scorer (6 tests) |
| #22 | 4.4   | Allocator dry-run endpoint |
| #23 | 4.5   | /allocator dashboard page |
| #24 | 4.6   | Allocator execute endpoint |
| #25 | 4.7   | Risk Manager veto (5 tests) |
| #26 | 5.1   | Voice context injects opportunities |
| #27 | 5.2   | Voice nav for opportunities/allocator/sources |
| #28 | 5.3   | Orchestrator sees opportunities snapshot |
| #29 | 5.4   | Opportunity expiry cron |

**Quality:**
- 50 unit tests across 8 test files, all passing
- Every PR ran pre-commit (typecheck on staged files)
- Conventional commits enforced
- Memory journal updated in every PR

## Stop reasons (won't auto-execute)

- **1.7** Claude Desktop smoke test — needs deployed URL
- **2.5** splitwatch repo push — splitwatch isn't a git repo
- **2.7** swing repo push — same
- **Phase 6+** LLM-driven dynamic tool calling, futures/forex providers, cross-asset alpha — deferred until Phase 0-5 lands and proves itself

## What you need to do when you're back

1. **Review + merge PRs #1-#29 in order.** `gh pr merge --squash --auto <num>` for each will queue them to auto-merge as parents land.
2. **Enable branch protection on `main`** in GitHub UI (Settings → Branches).
3. **After deploy:**
   - Register a Claude Desktop MCP token (recipe in `phase-1-mcp.md`)
   - Push a synthetic opportunity to test the end-to-end loop (recipe below)

## End-to-end smoke test recipe

```bash
URL=https://jarvis-system-flame.vercel.app
SECRET=j4rv1s-cr0n-s3cr3t-2026

# 1. Seed risk config
curl -X POST $URL/api/admin/risk-config -H "Authorization: Bearer $SECRET" -d '{"action":"seed"}'

# 2. Register a test client
TOKEN=$(curl -X POST $URL/api/admin/mcp-clients \
  -H "Authorization: Bearer $SECRET" \
  -d '{"name":"smoke-test","scopes":["write:opportunities"]}' | jq -r .token)

# 3. Push a synthetic opportunity
curl -X POST $URL/api/opportunities/ingest \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"source":"jarvis","asset_class":"equity","instrument":"TSLA","side":"long","thesis":"smoke test","entry_hint":250,"stop_hint":245,"win_prob":0.6,"expected_r":2,"confidence":0.8}'

# 4. Verify
curl $URL/api/opportunities | jq
# Open /opportunities in browser → row should be there

# 5. Run allocator plan
curl -X POST $URL/api/allocator/run
# Open /allocator → should show TSLA sized

# 6. Execute (CAUTION: places paper order)
OPPID=<paste id from step 4>
curl -X POST $URL/api/allocator/execute \
  -H "Authorization: Bearer $SECRET" \
  -d "{\"approved_ids\":[\"$OPPID\"]}"
```

## Phase status snapshot

- Phase 0: complete ✅
- Phase 1: code complete (1.7 smoke test post-deploy)
- Phase 2: Jarvis-side complete (2.5+2.7 cross-repo deferred)
- Phase 3: complete (futures/forex stubbed)
- Phase 4: complete
- Phase 5: complete

## Pacing rule (still in force)

One numbered step = one branch = one PR = one merge. No batching. Update
`CURRENT_PHASE.md` at the end of every PR.
