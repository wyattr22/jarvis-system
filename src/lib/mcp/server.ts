// Jarvis MCP server bootstrap.
//
// This file owns:
//   1. A typed tool registry — every MCP tool is declared via `registerTool`
//      with a zod input schema and a handler.
//   2. A pure dispatch function `dispatch(method, params)` that handles
//      JSON-RPC requests for `tools/list` and `tools/call`.
//
// The transport layer (HTTP/SSE in `src/app/api/mcp/route.ts`) does NOT live
// here — keep server logic transport-agnostic so it stays testable in vitest.

import { z, type ZodTypeAny } from "zod"

export type ToolHandler<T> = (input: T, ctx: ToolContext) => Promise<unknown>

export type ToolContext = {
  /** The MCP client that made the call (resolved by auth middleware). */
  clientId: string
  /** Scopes the client was issued. */
  scopes: string[]
}

export type ToolDef<T = unknown> = {
  name: string
  description: string
  inputSchema: ZodTypeAny
  /** Required scope to call this tool. Caller must have it. */
  requiredScope: string
  handler: ToolHandler<T>
}

const registry = new Map<string, ToolDef<unknown>>()

export function registerTool<T>(def: ToolDef<T>): void {
  if (registry.has(def.name)) {
    throw new Error(`MCP tool already registered: ${def.name}`)
  }
  registry.set(def.name, def as ToolDef<unknown>)
}

export function listTools(): { name: string; description: string; inputSchema: unknown }[] {
  return [...registry.values()].map(t => ({
    name: t.name,
    description: t.description,
    // Zod-to-JSONSchema would be richer; for now expose the description only.
    // Phase 1.6+ will swap in `zod-to-json-schema` so MCP clients see real shapes.
    inputSchema: { type: "object" },
  }))
}

export class McpError extends Error {
  constructor(public code: number, message: string) {
    super(message)
  }
}

export async function callTool(
  toolName: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = registry.get(toolName)
  if (!tool) throw new McpError(-32601, `unknown tool: ${toolName}`)
  if (!ctx.scopes.includes(tool.requiredScope) && !ctx.scopes.includes("*")) {
    throw new McpError(-32000, `missing scope: ${tool.requiredScope}`)
  }
  const parsed = tool.inputSchema.safeParse(rawInput ?? {})
  if (!parsed.success) {
    throw new McpError(-32602, `invalid params: ${parsed.error.message}`)
  }
  return tool.handler(parsed.data, ctx)
}

// JSON-RPC envelope: { jsonrpc, id, method, params }
export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: string | number | null
  method: string
  params?: unknown
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } }

export async function dispatch(req: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse> {
  try {
    if (req.method === "tools/list") {
      return { jsonrpc: "2.0", id: req.id, result: { tools: listTools() } }
    }
    if (req.method === "tools/call") {
      const params = (req.params ?? {}) as { name?: string; arguments?: unknown }
      if (!params.name) throw new McpError(-32602, "tools/call requires `name`")
      const result = await callTool(params.name, params.arguments, ctx)
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] },
      }
    }
    throw new McpError(-32601, `unknown method: ${req.method}`)
  } catch (err) {
    const e = err instanceof McpError ? err : new McpError(-32000, String(err))
    return { jsonrpc: "2.0", id: req.id, error: { code: e.code, message: e.message } }
  }
}

// Exported for tests so we can reset state between cases.
export function _clearRegistryForTesting(): void {
  registry.clear()
}

// Re-export zod so tool authors can write `import { z } from "@/lib/mcp/server"`
// and stay aligned with the version we validate against.
export { z }
