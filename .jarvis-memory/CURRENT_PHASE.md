# Current Phase

**Active phase:** Phase 1 — MCP Foundation
**Active step:** 4.4 — allocator dry-run endpoint (branch `phase-4.4/allocator-dryrun`)

Phase 1 is fully coded (PRs #1–8). 1.7 (Claude Desktop smoke test) is
post-deploy and waits on merge.

PRs #1–9 in flight, all stacked.

## What's in flight right now

The current branch `phase-0/workflow-foundation` lands all of the Phase 0
infrastructure in one PR because the pieces are tightly coupled and need to
exist before any feature PR can flow:

- 0a.4 `.github/PULL_REQUEST_TEMPLATE.md` ✓
- 0a.5 `.github/CODEOWNERS` ✓
- 0a.6 Branch protection on `main` (manual GitHub UI after merge)
- 0b.1 `.github/workflows/ci.yml` (typecheck + lint + test + build) ✓
- 0b.3 vitest + first test (`src/lib/sandbox/whitelist.test.ts`) ✓
- 0c.1 husky + lint-staged pre-commit hook ✓
- 0c.2 commitlint commit-msg hook ✓
- 0d.1 `.jarvis-memory/` skeleton ✓ (this file)
- 0d.2 CLAUDE.md cross-session instructions
- 0d.3 Seed CURRENT_PHASE.md + DECISIONS.md ✓ (this file)
- 0d.4 `src/lib/jarvis-memory/read.ts` reader

## Phase 1 queue

- 1.1 install `@modelcontextprotocol/sdk` ← branch open
- 1.2 `src/lib/mcp/server.ts` scaffold (empty tool registry)
- 1.3 `src/app/api/mcp/route.ts` POST handler (JSON-RPC tools/list + tools/call)
- 1.4 `mcp_clients` table + bearer auth middleware
- 1.5 SSE GET handler for streaming clients
- 1.6 first 3 tools: `memory.search`, `signals.list`, `account.snapshot`
- 1.7 smoke test from Claude Desktop / Claude Code
- 1.8 remaining 3 tools: `memory.save`, `source_quality.snapshot`, `voice.ask`

See plan at `/Users/wyattrantz/.claude/plans/ive-had-an-idea-curried-dawn.md`.

## Stop-checkpoint reminder

After Phase 0 lands and Phase 1.5 lands you have two natural stop points where
you can walk away for days/weeks and pick up cleanly from the next session.

## Pacing rule

One numbered step = one branch = one PR = one merge. No batching. Update this
file at the end of every PR so the next session knows where to start.
