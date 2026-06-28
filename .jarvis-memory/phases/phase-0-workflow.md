# Phase 0 — Dev Workflow + Cross-Session Memory

## Goal

Make the project developer-grade before any feature work. Repo, CI, hooks,
PR templates, and a markdown memory system that survives across Claude Code
sessions.

## What landed in PR `phase-0/workflow-foundation`

- GitHub repo `wyattr22/jarvis-system` (private) — `gh repo create … --push`.
- Conventional-commit history starts with `chore: bootstrap jarvis-system codebase`.
- `.github/PULL_REQUEST_TEMPLATE.md` — every PR must reference a plan step
  and update at least one `.jarvis-memory/` file.
- `.github/CODEOWNERS` — wyattr22 owns everything until collaborators arrive;
  risk-critical paths (sandbox, brokers, allocator, MCP, trade routes) called
  out explicitly.
- `.github/workflows/ci.yml` — typecheck + lint + test + build on push/PR.
  Stub env vars for build because some routes init SDKs at module top-level.
- `vitest` + `vitest.config.ts` + `src/lib/sandbox/whitelist.test.ts` (8/8
  passing) — proves the test pipeline works AND locks down a security-critical
  surface.
- `husky` pre-commit hook runs `lint-staged` (typecheck on staged TS files).
- `commitlint` commit-msg hook enforces conventional commits locally.
- `.jarvis-memory/` directory:
  - `INDEX.md` — read first
  - `CURRENT_PHASE.md` — live state
  - `DECISIONS.md` — ADRs (see for architecture choices)
  - `KNOWN_ISSUES.md` — open items
  - `phases/phase-0-workflow.md` — this file
- `CLAUDE.md` updated with a `## Cross-Session Memory` section teaching
  future Claude Code sessions to read `INDEX.md` at startup.
- `src/lib/jarvis-memory/read.ts` — reader exposing `getJarvisMemory(file?)`
  for Jarvis's voice route to inject runtime context.

## Manual step still required (cannot be scripted)

After PR merges, go to GitHub UI → Settings → Branches → Add branch
protection rule for `main`:
- Require PR before merging
- Require status checks: `CI / check`
- Disallow force pushes
- Require linear history (squash-merge only)

Log the protection settings in `DECISIONS.md` once enabled.

## Verification

- `pnpm test` → 8/8 passing
- `pnpm typecheck` → clean
- Fresh Claude Code session reads `CURRENT_PHASE.md` and reports next step
  without explanation.
