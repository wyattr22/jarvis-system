# Phase 1 — MCP Foundation

## Goal

Stand up an MCP server inside jarvis-system so external projects
(splitwatch, swing_scanner, trading_bot, Claude Desktop) can call typed
tools backed by Jarvis logic. HTTP + Server-Sent Events transport.

## Step log

### 1.1 — Install MCP SDK (branch `phase-1.1/install-mcp-sdk`)

- `pnpm add @modelcontextprotocol/sdk` → 1.29.0
- zod already a dep at 4.4.3
- `tsc --noEmit` clean

### 1.2 — MCP server scaffold (branch `phase-1.2/mcp-server-scaffold`)

Built `src/lib/mcp/server.ts` as a pure, transport-agnostic core:

- `registerTool(def)` — tools declare name, description, zod input schema,
  required scope, handler.
- `dispatch(jsonRpcReq, ctx)` — pure dispatcher for `tools/list` and
  `tools/call`. Returns a JSON-RPC response object; the HTTP/SSE transport
  layer (1.3) wraps this.
- Scope check: caller must have the tool's `requiredScope`, OR `"*"` (admin).
- Zod schema validates `tools/call` params before the handler runs.
- `McpError` carries JSON-RPC error codes (-32601 unknown method,
  -32602 invalid params, -32000 missing scope).
- `_clearRegistryForTesting()` exported so unit tests can reset state.

Test coverage: `src/lib/mcp/server.test.ts` — 9 cases, all passing.

### 1.3 — MCP HTTP POST handler (branch `phase-1.3/mcp-http-handler`)

- `src/app/api/mcp/route.ts` — POST wraps `dispatch()` with a JSON-RPC
  envelope check (-32700 on parse error, -32600 on invalid request shape).
- GET returns 501 for now; SSE streaming lands in 1.5.
- TEMPORARY: context uses `scopes: ["*"]` (wildcard). Real auth lands in 1.4.
  Safe because no tools are registered yet — `tools/list` returns `[]`.

Verification after deploy:
```
curl -X POST https://jarvis-system-flame.vercel.app/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Expected response: `{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}`
