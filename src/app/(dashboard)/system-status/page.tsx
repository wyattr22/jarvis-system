"use client"

import { useEffect, useState } from "react"

type CronCheck = {
  name: string
  path: string
  last_run_ts: number | null
  last_status: "ok" | "warn" | "down" | "unknown"
  freshness_label: string
}

type SystemStatus = {
  ts: number
  crons: CronCheck[]
  sources: { total: number; quarantined: number }
  mcp_clients: { total: number; active_24h: number }
  allocations: { today: number; filled_7d: number }
  opportunities: Record<string, number>
  drawdown_alerts_24h: { warn: number; danger: number }
}

const STATUS_COLORS: Record<string, string> = {
  ok:      "#00d4a1",
  warn:    "#f5c518",
  down:    "#ff5c5c",
  unknown: "#6b7280",
}

export default function SystemStatusPage() {
  const [data, setData] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () => {
      fetch("/api/system-status")
        .then(r => r.json())
        .then((d: SystemStatus) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  if (loading || !data) return <div style={{ padding: 24, color: "#9ca3af" }}>Loading…</div>

  const cronsHealthy = data.crons.filter(c => c.last_status === "ok").length
  const cronsTotal   = data.crons.length
  const oppsOpen     = data.opportunities.open ?? 0

  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>System Status</h1>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Single-page health check across crons, sources, MCP clients,
        opportunities, allocations, and drawdown alerts. Refreshes every 30s.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <Tile label="Crons" value={`${cronsHealthy}/${cronsTotal}`} color={cronsHealthy === cronsTotal ? "#00d4a1" : "#f5c518"} sub="healthy" />
        <Tile label="Sources" value={`${data.sources.total - data.sources.quarantined}/${data.sources.total}`} color={data.sources.quarantined === 0 ? "#00d4a1" : "#f5c518"} sub={`${data.sources.quarantined} quarantined`} />
        <Tile label="MCP Clients" value={`${data.mcp_clients.active_24h}/${data.mcp_clients.total}`} color={data.mcp_clients.total > 0 ? "#00d4a1" : "#6b7280"} sub="active 24h" />
        <Tile label="Open Opps" value={String(oppsOpen)} color="#33ccff" sub="awaiting allocator" />
        <Tile label="Allocations Today" value={String(data.allocations.today)} color="#9966ff" sub={`${data.allocations.filled_7d} filled 7d`} />
        <Tile label="Drawdown Alerts 24h" value={String(data.drawdown_alerts_24h.warn + data.drawdown_alerts_24h.danger)} color={data.drawdown_alerts_24h.danger > 0 ? "#ff5c5c" : data.drawdown_alerts_24h.warn > 0 ? "#f5c518" : "#00d4a1"} sub={`${data.drawdown_alerts_24h.danger} danger`} />
      </div>

      <h2 style={{ fontSize: 14, color: "#9ca3af", letterSpacing: 0.5, marginBottom: 12 }}>CRON HEALTH</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #1f2937", color: "#9ca3af", fontSize: 12, textAlign: "left" }}>
            <th style={th}>Cron</th>
            <th style={th}>Path</th>
            <th style={thRight}>Last run</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.crons.map(c => (
            <tr key={c.path} style={{ borderBottom: "1px solid #1f2937" }}>
              <td style={td}>{c.name}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>{c.path}</td>
              <td style={tdRight}>{c.freshness_label}</td>
              <td style={td}>
                <span style={{
                  background: STATUS_COLORS[c.last_status],
                  color: "#080d14",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                }}>{c.last_status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 14, color: "#9ca3af", letterSpacing: 0.5, marginBottom: 12 }}>OPPORTUNITIES BY STATUS</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {Object.entries(data.opportunities).map(([status, n]) => (
          <div key={status} style={{ background: "#0f1923", padding: "8px 16px", borderRadius: 4, fontSize: 13 }}>
            <span style={{ color: "#9ca3af" }}>{status}:</span> <b>{n}</b>
          </div>
        ))}
        {Object.keys(data.opportunities).length === 0 && (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>No opportunities yet.</div>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div style={{ background: "#0f1923", padding: 16, borderRadius: 6, border: "1px solid #1f2937" }}>
      <div style={{ fontSize: 11, color: "#9ca3af", letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{sub}</div>
    </div>
  )
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 500 }
const thRight: React.CSSProperties = { ...th, textAlign: "right" }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13 }
const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }
