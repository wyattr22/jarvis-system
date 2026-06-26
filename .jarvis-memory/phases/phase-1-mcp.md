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

Next: 1.2 scaffolds `src/lib/mcp/server.ts`.
