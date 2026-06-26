// HTTP transport for the Jarvis MCP server.
//
//   POST /api/mcp  → JSON-RPC request/response (single-shot, for any client)
//   GET  /api/mcp  → reserved for SSE streaming (lands in 1.5)
//
// Bearer-token auth (1.4): every request must carry `Authorization: Bearer ...`
// matching either a row in `mcp_clients` (per-project) or CRON_SECRET (admin).

import { dispatch, type JsonRpcRequest } from "@/lib/mcp/server"
import { authenticateRequest } from "@/lib/mcp/auth"

export const maxDuration = 60

export async function POST(req: Request) {
  const auth = await authenticateRequest(req)
  if (!auth.ok) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: auth.message } },
      { status: auth.status },
    )
  }

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

  const result = await dispatch(rpc, auth.ctx)
  return Response.json(result)
}

export async function GET() {
  return Response.json(
    { error: "SSE streaming lands in step 1.5 — use POST for now" },
    { status: 501 },
  )
}
