# Current Phase

**Active phase:** Phase 0 — Dev Workflow + Cross-Session Memory
**Active step:** 0a.4–0d.4 bundled in PR `phase-0/workflow-foundation`

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

## Next up after PR merges

**Phase 1.1 — Install MCP SDK** on a new branch `phase-1.1/install-mcp-sdk`:
- `pnpm add @modelcontextprotocol/sdk` (zod already installed)
- type-check, commit, push, PR, merge.

Then 1.2 → 1.3 → ... one branch per step. See the plan at
`/Users/wyattrantz/.claude/plans/ive-had-an-idea-curried-dawn.md`.

## Stop-checkpoint reminder

After Phase 0 lands and Phase 1.5 lands you have two natural stop points where
you can walk away for days/weeks and pick up cleanly from the next session.

## Pacing rule

One numbered step = one branch = one PR = one merge. No batching. Update this
file at the end of every PR so the next session knows where to start.
