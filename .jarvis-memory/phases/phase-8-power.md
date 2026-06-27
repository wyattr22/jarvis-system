# Phase 8 — Test coverage + power features

## Goal

Lock down behaviour of the MCP catalog + sandbox layer with real tests;
add a /performance dashboard for at-a-glance P&L; ship a time-stop
monitor so positions don't drift past their intended horizon.

## Step log

### 8.1 — MCP tool registry tests (branch `phase-8.1/mcp-tool-tests`)

`src/lib/mcp/tools/registry.test.ts` — 7 tests:
- All 17 expected tool names registered after side-effect imports
- Tool count ≥ 17 (forwards-only)
- Every tool has a description ≥ 20 chars
- Scope strings parseable
- Scope enforcement: rejects execute:trades for read-only, write:memory for read-only
- Wildcard `*` scope passes the scope check

`beforeAll` loads tool modules once (cached imports + idempotent
registerTool means per-test resets don't work — see test file comment).

76 total tests passing across 13 files.

Next: 8.2 sandbox/quality tests.