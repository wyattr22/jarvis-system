"use client"

import { useEffect, useState } from "react"

type Allocation = {
  id: string
  opportunity_id: string
  broker: string
  order_id: string | null
  allocated_usd: number
  risk_per_trade_pct: number
  decided_by: "user" | "auto" | "council"
  decided_at: number
  status: "submitted" | "filled" | "rejected" | "error"
  error?: string | null
}

type ApiResponse = { allocations: Allocation[]; count: number }

const STATUS_COLORS: Record<string, string> = {
  submitted: "#33ccff",
  filled:    "#00d4a1",
  rejected:  "#ff5c5c",
  error:     "#ff5c5c",
}

function fmtAgo(ts: number): string {
  const ms = Date.now() - ts
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

export default function AllocationsPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () => {
      fetch("/api/allocations?limit=200")
        .then(r => r.json())
        .then((d: ApiResponse) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Allocations</h1>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Every order the allocator has submitted. Audit trail of what was
        executed, when, by whom (user/council/auto), and current broker status.
      </p>

      {loading && <div style={{ color: "#9ca3af" }}>Loading…</div>}
      {!loading && data && data.allocations.length === 0 && (
        <div style={{ color: "#9ca3af", padding: 32, textAlign: "center" }}>
          No allocations yet. Approve an opportunity in /allocator and execute it.
        </div>
      )}
      {!loading && data && data.allocations.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1f2937", color: "#9ca3af", fontSize: 12, textAlign: "left" }}>
              <th style={th}>When</th>
              <th style={th}>Opportunity</th>
              <th style={th}>Broker</th>
              <th style={th}>Order ID</th>
              <th style={thRight}>$ Allocated</th>
              <th style={thRight}>Risk %</th>
              <th style={th}>By</th>
              <th style={th}>Status</th>
              <th style={th}>Error</th>
            </tr>
          </thead>
          <tbody>
            {data.allocations.map(a => (
              <tr key={a.id} style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={td}>{fmtAgo(a.decided_at)} ago</td>
                <td style={td}><code style={{ color: "#9ca3af", fontSize: 12 }}>{a.opportunity_id}</code></td>
                <td style={td}>{a.broker}</td>
                <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>{a.order_id ?? "—"}</td>
                <td style={tdRight}>${a.allocated_usd.toFixed(0)}</td>
                <td style={tdRight}>{(a.risk_per_trade_pct * 100).toFixed(2)}%</td>
                <td style={td}>{a.decided_by}</td>
                <td style={td}>
                  <span style={{
                    background: STATUS_COLORS[a.status] ?? "#6b7280",
                    color: "#080d14",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                  }}>{a.status}</span>
                </td>
                <td style={{ ...td, color: "#ff5c5c", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.error ?? ""}>
                  {a.error ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 500 }
const thRight: React.CSSProperties = { ...th, textAlign: "right" }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13 }
const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }
