// HTTP transport for the Jarvis MCP server.
//
//   POST /api/mcp  → JSON-RPC request/response (single-shot, for any client)
//   GET  /api/mcp  → reserved for SSE streaming (lands in 1.5)
//
// Bearer-token auth (1.4): every request must carry `Authorization: Bearer ...`
// matching either a row in `mcp_clients` (per-project) or CRON_SECRET (admin).

import { dispatch, type JsonRpcRequest } from "@/lib/mcp/server"
import { authenticateRequest } from "@/lib/mcp/auth"
// Side-effect import: registers all Jarvis-native tools at module load.
// Add new tool files here as they land.
import "@/lib/mcp/tools/jarvis"
import "@/lib/mcp/tools/splitwatch"
import "@/lib/mcp/tools/swing"
import "@/lib/mcp/tools/brokers"
import "@/lib/mcp/tools/allocator"
import "@/lib/mcp/tools/opportunities"
import "@/lib/mcp/tools/allocator"

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

// SSE stream for MCP clients that prefer the long-lived bidirectional pattern
// (e.g. Claude Desktop via mcp-remote). Sends an initial `endpoint` event
// telling the client where to POST commands, then keepalive comments every
// 15 seconds to defeat proxies that idle out long-quiet streams.
//
// Vercel function timeout caps the stream lifetime; clients reconnect when
// the stream ends.
export async function GET(req: Request) {
  const auth = await authenticateRequest(req)
  if (!auth.ok) {
    return new Response(auth.message, { status: auth.status })
  }

  const url = new URL(req.url)
  const postUrl = `${url.origin}/api/mcp`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Initial event: tell the client where to POST RPC requests.
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${postUrl}\n\n`))

      // Keepalive comment every 15s. SSE comments start with `:` and are ignored
      // by parsers but keep intermediaries from idling out the connection.
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`))
        } catch {
          clearInterval(interval)
        }
      }, 15_000)

      req.signal.addEventListener("abort", () => {
        clearInterval(interval)
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
