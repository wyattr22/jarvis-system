@AGENTS.md

## Cross-Session Memory

This repo has a persistent, git-tracked memory system at `.jarvis-memory/`.
At the start of every session, **read `.jarvis-memory/INDEX.md` first**, then
whichever pointer it surfaces that's relevant to the current work — almost
always `CURRENT_PHASE.md` (live state) and `DECISIONS.md` (architecture
choices).

Do not re-derive context that's already documented there.

**Every PR must update at least `.jarvis-memory/CURRENT_PHASE.md`** to reflect
the step just completed and the next queued step. The PR template enforces
this. New architectural decisions go in `DECISIONS.md`. Open blockers go in
`KNOWN_ISSUES.md`.

The full plan we're executing against lives at
`/Users/wyattrantz/.claude/plans/lovely-snacking-glacier.md` (Phases 15–21,
started 2026-07-25). Earlier plans (e.g. `ive-had-an-idea-curried-dawn.md`,
`ok-i-want-to-sprightly-puppy.md`) are superseded — phases 11–14 they covered
are complete; see `CURRENT_PHASE.md` for what's still open.

## Workflow

- One numbered plan step = one branch (`phase-X.Y/short-description`) = one PR.
- Conventional commits enforced by commitlint.
- Pre-commit hook runs `tsc --noEmit` on staged files (husky + lint-staged).
- CI must pass (typecheck + lint + build + tests) before merge.
- `main` is branch-protected — no direct pushes.
- Never use `--no-verify` to bypass hooks. Fix the underlying issue instead.
