// Admin endpoint to manage MCP clients.
// Auth: CRON_SECRET only — these operations control who can talk to the MCP.
//
//   GET  /api/admin/mcp-clients              → list registered clients
//   POST /api/admin/mcp-clients              → create a new client + return token ONCE
//   DELETE /api/admin/mcp-clients?id=mcp_xxx → revoke a client

import { listClients, registerClient, revokeClient } from "@/lib/mcp/auth"

function unauthorized() {
  return new Response("Unauthorized", { status: 401 })
}

function checkAuth(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? ""
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return unauthorized()
  return Response.json({ clients: await listClients() })
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return unauthorized()
  let body: { name?: string; scopes?: string[] }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  if (!body.name || typeof body.name !== "string") {
    return Response.json({ error: "name required" }, { status: 400 })
  }
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter(s => typeof s === "string") : []
  const { id, token } = await registerClient(body.name, scopes)
  return Response.json({
    id,
    name: body.name,
    scopes,
    token,
    notice: "store this token now — it is NOT shown again",
  })
}

export async function DELETE(req: Request) {
  if (!checkAuth(req)) return unauthorized()
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return Response.json({ error: "id required" }, { status: 400 })
  await revokeClient(id)
  return Response.json({ ok: true })
}
