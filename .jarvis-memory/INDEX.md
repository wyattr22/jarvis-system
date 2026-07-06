# Jarvis Memory Index

This directory is the cross-session memory for everyone working on Jarvis —
future Claude Code sessions, Jarvis himself at runtime, and human collaborators.

**Read this file first.** Then read whichever pointer below is relevant to what
you're trying to do. Don't re-derive context that's already documented.

---

## Core (always read at session start)

- [CURRENT_PHASE.md](CURRENT_PHASE.md) — which numbered plan step is in progress, what's queued next.
- [DECISIONS.md](DECISIONS.md) — ADR-style log of architectural choices. Read before re-litigating any of these.
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — open bugs, blockers, WIP that didn't make a PR yet.

## Phase journals (read the phase that matches current work)

- [phases/phase-0-workflow.md](phases/phase-0-workflow.md) — dev workflow + memory system bootstrap
- [phases/phase-1-mcp.md](phases/phase-1-mcp.md) — internal MCP server foundation
- [phases/phase-2-onboarding.md](phases/phase-2-onboarding.md) — splitwatch + swing_scanner integration
- [phases/phase-3-adapters.md](phases/phase-3-adapters.md) — multi-asset broker adapters
- [phases/phase-4-allocator.md](phases/phase-4-allocator.md) — risk-aware allocator
- [phases/phase-5-engine.md](phases/phase-5-engine.md) — voice/council see everything

## Domain reference (read on demand)

- [domain/architecture.md](domain/architecture.md) — high-level system map
- [domain/mcp-tool-catalog.md](domain/mcp-tool-catalog.md) — every MCP tool with shape + scope
- [domain/risk-config.md](domain/risk-config.md) — current risk caps + reasoning
- [domain/api-budgets.md](domain/api-budgets.md) — free-tier API audit: caps, consumption, fallbacks, delay honesty

## Session journals (recent context)

- See `sessions/YYYY-MM-DD-topic.md` files. Latest reflects most recent work.

---

## How to update this directory

- **Finished a plan step?** Update `CURRENT_PHASE.md` + the relevant `phases/phase-X.md` in the same PR.
- **Made an architecture decision?** Append an entry to `DECISIONS.md` (date, decision, why).
- **Hit a blocker / found a bug you can't fix yet?** Add to `KNOWN_ISSUES.md` so future-you sees it.
- **End of a working session?** Drop a short note in `sessions/YYYY-MM-DD-topic.md`: what was done, what's open.

Markdown only. Keep entries short. Link rather than duplicate.
