# Phase 6 — Polish & Operability

## Goal

After Phases 0-5 prove the architecture, Phase 6 fills in the operability
gaps: MCP tools that wrap the new allocator endpoints, dashboards for
risk-config + mcp-clients + allocations, drawdown monitoring, and outcome
tracking so we actually learn from executed trades.

## Step log

### 6.1 — Allocator MCP tools (branch `phase-6.1/allocator-mcp-tools`)

`src/lib/mcp/tools/allocator.ts` adds 3 tools:

- `allocator.plan` (scope `read:account`) — runs live planning, returns full
  ranked plan + risk-manager verdict + warnings
- `allocator.summary` (scope `read:account`) — short prose summary suited
  for chat clients
- `allocator.execute` (scope `execute:trades`) — proxies to /api/allocator/execute
  via safeFetch so all execution + audit + idempotency logic stays in one place

Now Claude clients can ask "Jarvis, what's the allocator plan?" and get a
real ranked answer, or "execute opps X, Y, Z" with execute scope.

13 total MCP tools registered.

Next: 6.2 opportunities MCP tools.