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

### 6.2 — Opportunities MCP tools (branch `phase-6.2/opportunities-mcp-tools`)

`src/lib/mcp/tools/opportunities.ts` adds 4 tools (separate from source-specific
splitwatch/swing tools):

- `opportunities.list` — full filtered query, all sources
- `opportunities.top` — top-N by score with confidence floor 0.5 (chat-friendly)
- `opportunities.update_status` — approve/reject/mute/reopen, audit_log entry
- `opportunities.ingest` — push new opp from any client with write scope

17 total MCP tools registered now.

### 6.3 — /allocations dashboard (branch `phase-6.3/allocations-dashboard`)

- `GET /api/allocations?limit=N` — list execution history
- `/allocations` page renders the audit table: when, opportunity_id, broker,
  order_id, $ allocated, risk %, decided_by, status badge, error column
- Sidebar: ALLOCATIONS link added (next to ALLOCATOR)

### 6.4 — /risk-config dashboard (branch `phase-6.4/risk-config-dashboard`)

`/risk-config` page — editable form for every risk cap (per-trade %, daily
loss %, max positions, correlated exposure, Kelly cap, asset class caps).
Saves via POST to `/api/admin/risk-config` (requires CRON_SECRET pasted
into the UI — never stored client-side). Also exposes "Reset to Defaults".

Sidebar: RISK CONFIG link added.

Next: 6.5 /mcp-clients dashboard.