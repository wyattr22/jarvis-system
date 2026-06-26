// HTTP transport for the Jarvis MCP server.
//
//   POST /api/mcp  → JSON-RPC request/response (single-shot, for any client)
//   GET  /api/mcp  → reserved for SSE streaming (lands in 1.5)
//
// Auth lands in 1.4 — until then the route uses an unauthenticated "noauth"
// context with the wildcard scope so curl tests work. The first real tools
// (1.6) won't ship until 1.4 is merged so this temporary opening is safe.

import { dispatch, type JsonRpcRequest } from "@/lib/mcp/server"

// Reserved here for the moment dispatch grows real tools that need extra time.
// Vercel's default is 300s on hobby.
export const maxDuration = 60

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      { status: 400 },
    )
  }

  const rpc = body as JsonRpcRequest
  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } },
      { status: 400 },
    )
  }

  // TEMPORARY: wildcard scope. Real auth lands in 1.4.
  const ctx = { clientId: "noauth", scopes: ["*"] }
  const result = await dispatch(rpc, ctx)
  return Response.json(result)
}

export async function GET() {
  return Response.json(
    { error: "SSE streaming lands in step 1.5 — use POST for now" },
    { status: 501 },
  )
}
