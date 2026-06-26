"use client"

import { useEffect, useState } from "react"

type SourceRow = {
  source_name: string
  last_ok: number
  last_confidence: number
  last_ts: number
  pass_rate_24h: number
  count_24h: number
}

type ApiResponse = {
  sources: SourceRow[]
  quarantined: number
  sandbox_blocked_24h: number
  threshold: number
}

function badgeFor(conf: number, threshold: number): { label: string; color: string } {
  if (conf >= 0.8) return { label: "GOOD", color: "#00d4a1" }
  if (conf >= threshold) return { label: "OK", color: "#f5c518" }
  return { label: "LOW CONFIDENCE", color: "#ff5c5c" }
}

function fmtAgo(ts: number): string {
  const ms = Date.now() - ts
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export default function SourceQualityPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () => {
      fetch("/api/source-quality")
        .then(r => r.json())
        .then((d: ApiResponse) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  if (loading) return <div style={{ padding: 24, color: "#9ca3af" }}>Loading source quality…</div>
  if (!data) return <div style={{ padding: 24, color: "#ff5c5c" }}>Failed to load source quality.</div>

  const sorted = [...data.sources].sort((a, b) => a.last_confidence - b.last_confidence)

  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Source Quality</h1>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Every external data source is validated before its result enters the LLM context or the
        predictive model. Sources below {data.threshold.toFixed(2)} confidence are stripped from
        the model input but still displayed for transparency.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <div style={panelStyle}>
          <div style={panelLabelStyle}>QUARANTINED</div>
          <div style={{ ...panelValueStyle, color: data.quarantined > 0 ? "#ff5c5c" : "#00d4a1" }}>
            {data.quarantined}
          </div>
        </div>
        <div style={panelStyle}>
          <div style={panelLabelStyle}>SANDBOX BLOCKS 24H</div>
          <div style={{ ...panelValueStyle, color: data.sandbox_blocked_24h > 0 ? "#f5c518" : "#9ca3af" }}>
            {data.sandbox_blocked_24h}
          </div>
        </div>
        <div style={panelStyle}>
          <div style={panelLabelStyle}>TOTAL SOURCES</div>
          <div style={panelValueStyle}>{data.sources.length}</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #1f2937", color: "#9ca3af", fontSize: 12, textAlign: "left" }}>
            <th style={th}>Source</th>
            <th style={th}>Status</th>
            <th style={thRight}>Confidence</th>
            <th style={thRight}>24h pass rate</th>
            <th style={thRight}>Last fetch</th>
            <th style={thRight}>Sample size</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const b = badgeFor(r.last_confidence, data.threshold)
            return (
              <tr key={r.source_name} style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={td}>{r.source_name}</td>
                <td style={td}>
                  <span style={{
                    background: b.color,
                    color: "#080d14",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                  }}>{b.label}</span>
                </td>
                <td style={tdRight}>{r.last_confidence.toFixed(2)}</td>
                <td style={tdRight}>{(r.pass_rate_24h * 100).toFixed(0)}%</td>
                <td style={tdRight}>{fmtAgo(r.last_ts)}</td>
                <td style={tdRight}>{r.count_24h}</td>
              </tr>
            )
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={6} style={{ ...td, color: "#9ca3af", textAlign: "center", padding: 32 }}>
              No source events recorded yet. Fire a voice query to populate this page.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: "#0f1923",
  border: "1px solid #1f2937",
  borderRadius: 6,
  padding: "12px 16px",
  minWidth: 140,
}
const panelLabelStyle: React.CSSProperties = { fontSize: 11, color: "#9ca3af", letterSpacing: 0.5 }
const panelValueStyle: React.CSSProperties = { fontSize: 24, fontWeight: 600, marginTop: 4 }
const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 500 }
const thRight: React.CSSProperties = { ...th, textAlign: "right" }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13 }
const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }
