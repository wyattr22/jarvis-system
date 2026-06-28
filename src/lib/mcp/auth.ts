// MCP authentication.
//
// Bearer tokens, SHA-256 hashed, stored in `mcp_clients` table with per-client
// JSON scopes. Validate every MCP request before dispatch.
//
// CRON_SECRET also accepted with wildcard scope so we don't break existing
// admin/cron workflows that already use it.

import { createHash } from "node:crypto"
import { db } from "@/lib/db/client"
import type { ToolContext } from "@/lib/mcp/server"

let tableReady = false
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mcp_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      last_seen INTEGER
    )
  `)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mcp_clients_hash ON mcp_clients(token_hash)`)
  tableReady = true
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? ""
  if (!h.toLowerCase().startsWith("bearer ")) return null
  return h.slice(7).trim() || null
}

export type AuthResult =
  | { ok: true; ctx: ToolContext }
  | { ok: false; status: number; message: string }

export async function authenticateRequest(req: Request): Promise<AuthResult> {
  const token = extractBearer(req)
  if (!token) return { ok: false, status: 401, message: "missing bearer token" }

  // Admin/cron back door: existing CRON_SECRET gets wildcard scope.
  if (token === process.env.CRON_SECRET) {
    return { ok: true, ctx: { clientId: "cron", scopes: ["*"] } }
  }

  await ensureTable()
  const hash = hashToken(token)
  const r = await db.execute({
    sql: `SELECT id, name, scopes_json FROM mcp_clients WHERE token_hash = ? LIMIT 1`,
    args: [hash],
  })
  if (!r.rows.length) return { ok: false, status: 401, message: "unknown token" }

  const row = r.rows[0] as unknown as { id: string; name: string; scopes_json: string }
  let scopes: string[] = []
  try { scopes = JSON.parse(row.scopes_json) } catch { /* empty scopes */ }

  // Touch last_seen — best-effort, fire and forget.
  db.execute({
    sql: `UPDATE mcp_clients SET last_seen = ? WHERE id = ?`,
    args: [Date.now(), row.id],
  }).catch(() => { /* ignore */ })

  return { ok: true, ctx: { clientId: String(row.id), scopes } }
}

// Admin helper: register a new client and return the plaintext token ONCE.
// Caller is responsible for delivering the token to the client securely.
export async function registerClient(
  name: string,
  scopes: string[],
): Promise<{ id: string; token: string }> {
  await ensureTable()
  const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  // 32-byte URL-safe random token.
  const tokenBytes = new Uint8Array(32)
  crypto.getRandomValues(tokenBytes)
  const token = Buffer.from(tokenBytes).toString("base64url")
  await db.execute({
    sql: `INSERT INTO mcp_clients (id, name, token_hash, scopes_json, created_at) VALUES (?,?,?,?,?)`,
    args: [id, name, hashToken(token), JSON.stringify(scopes), Date.now()],
  })
  return { id, token }
}

export async function listClients(): Promise<
  { id: string; name: string; scopes: string[]; created_at: number; last_seen: number | null }[]
> {
  await ensureTable()
  const r = await db.execute({
    sql: `SELECT id, name, scopes_json, created_at, last_seen FROM mcp_clients ORDER BY created_at DESC`,
    args: [],
  })
  return r.rows.map(row => {
    const r = row as unknown as { id: string; name: string; scopes_json: string; created_at: number; last_seen: number | null }
    let scopes: string[] = []
    try { scopes = JSON.parse(r.scopes_json) } catch { /* empty */ }
    return {
      id: String(r.id),
      name: String(r.name),
      scopes,
      created_at: Number(r.created_at),
      last_seen: r.last_seen === null ? null : Number(r.last_seen),
    }
  })
}

export async function revokeClient(id: string): Promise<void> {
  await ensureTable()
  await db.execute({ sql: `DELETE FROM mcp_clients WHERE id = ?`, args: [id] })
}
