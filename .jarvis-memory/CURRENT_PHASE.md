# Current Phase

**Active step:** 4.6 — allocator execute endpoint (branch `phase-4.6/allocator-execute`)

## What just landed (autonomous Costco-run session, 2026-06-27)

**23 stacked PRs covering Phase 0 → Phase 4.5:**

| PR  | Step  | What                                         |
|-----|-------|----------------------------------------------|
| #1  | 0     | Workflow + CI + hooks + memory system        |
| #2  | 1.1   | Install @modelcontextprotocol/sdk            |
| #3  | 1.2   | MCP server scaffold + dispatch + tests       |
| #4  | 1.3   | MCP HTTP POST handler                        |
| #5  | 1.4   | Bearer auth + admin client registry          |
| #6  | 1.5   | SSE GET handler                              |
| #7  | 1.6   | First 3 MCP tools                            |
| #8  | 1.8   | Last 3 MCP tools                             |
| #9  | 2.1   | opportunities table + store                  |
| #10 | 2.2   | Ingest endpoint (bearer-auth)                |
| #11 | 2.3   | Opportunities dashboard + GET API            |
| #12 | 2.4   | splitwatch MCP tool                          |
| #13 | 2.6   | swing MCP tool                               |
| #14 | 2.8   | Approve/reject/mute actions                  |
| #15 | 3.1   | BrokerAdapter interface                      |
| #16 | 3.2   | AlpacaAdapter                                |
| #17 | 3.3   | Futures + forex stubs                        |
| #18 | 3.4   | Adapter registry + brokers.* MCP tools       |
| #19 | 4.1   | risk_config table + admin endpoint           |
| #20 | 4.2   | Kelly-capped sizer                           |
| #21 | 4.3   | Portfolio scorer                             |
| #22 | 4.4   | Allocator dry-run endpoint                   |
| #23 | 4.5   | /allocator dashboard page                    |

**All 23 PRs:**
- TypeScript clean (`tsc --noEmit`)
- 45 unit tests passing across 7 test files
- Pre-commit hooks fire on every commit
- Conventional commits enforced
- Memory file (`.jarvis-memory/CURRENT_PHASE.md` + per-phase journals) updated in every PR

## Stop reasons (won't auto-execute)

- **1.7 — Claude Desktop smoke test** — needs the deployed MCP URL.
- **2.5 — splitwatch repo PR** — splitwatch isn't a git repo yet. Recipe documented in `.jarvis-memory/phases/phase-2-onboarding.md`.
- **2.7 — swing repo PR** — same, user picks between swing_scanner (Python) and swing-research (Node).
- **4.6 — Allocator execute endpoint** — runs real orders. Wait for user to confirm risk tolerance.
- **4.7 — Risk Manager council veto** — extends the existing council agent; lands once 4.6 ships.
- **Phase 5 — Voice / Council see opportunities** — best to land after Phase 4 is fully tested.

## What you need to do when you're back

1. **Review + merge the PR stack.** Suggested order: just walk #1 → #23 sequentially; GitHub auto-rebases the next branch when its parent merges. If you want to skip review and trust the stack, `gh pr merge --squash --auto <num>` queues them all to auto-merge as their parents land.
2. **Enable branch protection on `main`** (Settings → Branches → Add rule → require PR + status checks `CI / check`). Doc the settings in `DECISIONS.md` via a tiny follow-up PR.
3. **After everything's merged + deployed:**
   - Register a Claude Desktop MCP token (see phase-1-mcp.md)
   - Open `/allocator` in the dashboard, click "Run Plan" — empty state until opportunities arrive
   - Push a synthetic opportunity to verify the full loop:
     ```bash
     curl -X POST $URL/api/admin/mcp-clients \
       -H "Authorization: Bearer $CRON_SECRET" \
       -d '{"name":"test-pusher","scopes":["write:opportunities"]}'
     # save the token

     curl -X POST $URL/api/opportunities/ingest \
       -H "Authorization: Bearer $TOKEN" \
       -d '{"source":"jarvis","asset_class":"equity","instrument":"TSLA","side":"long","thesis":"smoke test","entry_hint":250,"stop_hint":245,"win_prob":0.6,"expected_r":2}'
     ```
     Open `/opportunities` → see the row. Open `/allocator` → run plan → see TSLA sized.

## Phase status snapshot

- **Phase 0:** complete (workflow + memory)
- **Phase 1:** code complete (PRs #1-#8). 1.7 smoke test is post-deploy.
- **Phase 2:** Jarvis-side complete (PRs #9-#14). Cross-repo PRs (2.5, 2.7) deferred until splitwatch/swing repos exist.
- **Phase 3:** complete (PRs #15-#18). Futures + forex adapters are stubs awaiting provider choice.
- **Phase 4:** 4.1-4.5 complete (PRs #19-#23). 4.6 (execute) + 4.7 (council veto) deferred for user approval.
- **Phase 5:** not started.

## Pacing rule (still in force)

One numbered step = one branch = one PR = one merge. No batching. Update
`CURRENT_PHASE.md` at the end of every PR.
