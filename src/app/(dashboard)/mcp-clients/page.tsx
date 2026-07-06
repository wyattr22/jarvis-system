"use client"

import { useEffect, useState } from "react"

type Client = {
  id: string
  name: string
  scopes: string[]
  created_at: number
  last_seen: number | null
}

const AVAILABLE_SCOPES = [
  "read:memory", "write:memory",
  "read:signals",
  "read:account",
  "read:opportunities", "write:opportunities",
  "execute:trades",
  "*",
]

function fmtAgo(ts: number | null): string {
  if (!ts) return "never"
  const ms = Date.now() - ts
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export default function McpClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [secret, setSecret] = useState("")
  const [newName, setNewName] = useState("")
  const [newScopes, setNewScopes] = useState<string[]>(["read:opportunities"])
  const [issuedToken, setIssuedToken] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    if (!secret) return
    setLoading(true)
    const r = await fetch("/api/admin/mcp-clients", { headers: { "Authorization": `Bearer ${secret}` } })
    if (r.ok) setClients((await r.json()).clients)
    else setMsg(`HTTP ${r.status}`)
    setLoading(false)
  }

  useEffect(() => { if (secret) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [secret])

  async function registerClient() {
    if (!secret || !newName) return
    const r = await fetch("/api/admin/mcp-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
      body: JSON.stringify({ name: newName, scopes: newScopes }),
    })
    if (r.ok) {
      const data = await r.json()
      setIssuedToken(data.token)
      setNewName("")
      load()
    } else setMsg(`HTTP ${r.status}`)
  }

  async function revoke(id: string) {
    if (!secret) return
    if (!confirm(`Revoke client ${id}? Its bearer token stops working immediately.`)) return
    const r = await fetch(`/api/admin/mcp-clients?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${secret}` },
    })
    if (r.ok) load()
    else setMsg(`HTTP ${r.status}`)
  }

  return (
    <div style={{ padding: 24, color: "#e5e7eb", maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>MCP Clients</h1>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Registered external clients that can call /api/mcp with a bearer token.
        Each has its own scope set. Token is hashed (SHA-256) — only the plaintext
        version is shown ONCE at creation.
      </p>

      <div style={{ marginBottom: 24, borderBottom: "1px solid #1f2937", paddingBottom: 16 }}>
        <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8 }}>CRON_SECRET (required to view/manage):</p>
        <input style={input} type="password" placeholder="Bearer CRON_SECRET" value={secret}
               onChange={e => setSecret(e.target.value)} />
        {msg && <span style={{ color: "#ff5c5c", marginLeft: 12 }}>{msg}</span>}
      </div>

      {secret && (
        <>
          <div style={{ marginBottom: 24, padding: 16, background: "#0f1923", borderRadius: 6 }}>
            <h3 style={{ fontSize: 13, color: "#9ca3af", marginBottom: 8 }}>REGISTER NEW CLIENT</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input style={{ ...input, flex: 1 }} placeholder="client name (e.g. claude-desktop)" value={newName}
                     onChange={e => setNewName(e.target.value)} />
              <button onClick={registerClient} disabled={!newName} style={btn}>Register</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {AVAILABLE_SCOPES.map(s => (
                <label key={s} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: "#9ca3af", cursor: "pointer" }}>
                  <input type="checkbox" checked={newScopes.includes(s)}
                         onChange={() => setNewScopes(newScopes.includes(s) ? newScopes.filter(x => x !== s) : [...newScopes, s])} />
                  {s}
                </label>
              ))}
            </div>
            {issuedToken && (
              <div style={{ marginTop: 12, padding: 12, background: "#080d14", border: "1px solid #00d4a1", borderRadius: 4 }}>
                <p style={{ color: "#00d4a1", fontSize: 12, marginBottom: 4 }}>TOKEN (shown once — copy now):</p>
                <code style={{ fontSize: 13, color: "#e5e7eb", wordBreak: "break-all" }}>{issuedToken}</code>
                <button onClick={() => setIssuedToken(null)} style={{ ...btn, marginLeft: 12, padding: "4px 12px", fontSize: 11 }}>I saved it</button>
              </div>
            )}
          </div>

          {loading && <div style={{ color: "#9ca3af" }}>Loading clients…</div>}
          {!loading && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1f2937", color: "#9ca3af", fontSize: 12, textAlign: "left" }}>
                  <th style={th}>Name</th>
                  <th style={th}>ID</th>
                  <th style={th}>Scopes</th>
                  <th style={th}>Created</th>
                  <th style={th}>Last seen</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id} style={{ borderBottom: "1px solid #1f2937" }}>
                    <td style={td}><b>{c.name}</b></td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>{c.id}</td>
                    <td style={td}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {c.scopes.map(s => (
                          <span key={s} style={{ background: "#1f2937", padding: "2px 6px", borderRadius: 3, fontSize: 11 }}>{s}</span>
                        ))}
                      </div>
                    </td>
                    <td style={td}>{fmtAgo(c.created_at)}</td>
                    <td style={td}>{fmtAgo(c.last_seen)}</td>
                    <td style={td}>
                      <button onClick={() => revoke(c.id)}
                              style={{ ...btn, background: "transparent", color: "#ff5c5c", border: "1px solid #ff5c5c", padding: "4px 10px", fontSize: 11 }}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr><td colSpan={6} style={{ ...td, color: "#9ca3af", textAlign: "center", padding: 32 }}>
                    No clients registered yet.
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

const input: React.CSSProperties = {
  background: "#0f1923",
  color: "#e5e7eb",
  border: "1px solid #1f2937",
  padding: "6px 10px",
  borderRadius: 4,
  fontSize: 13,
  width: 320,
}

const btn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "none",
  background: "#00d4a1",
  color: "#080d14",
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 500 }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13 }
