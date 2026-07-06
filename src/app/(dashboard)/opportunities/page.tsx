"use client"

import { useEffect, useState } from "react"
import { parseInstrument } from "@/lib/instruments/parse"
import { formatInstrument } from "@/lib/instruments/format"
import type { AssetClass } from "@/lib/brokers/adapter"

// Human-readable instrument for non-equity asset classes
// ("SPY 18 Jul '25 $550 Call" instead of "SPY250718C00550000").
function displayInstrument(instrument: string, assetClass: string): string {
  if (assetClass === "equity" || assetClass === "crypto") return instrument
  return formatInstrument(parseInstrument(instrument, assetClass as AssetClass))
}

type Opportunity = {
  id: string
  source: string
  asset_class: string
  instrument: string
  side: "long" | "short"
  thesis: string
  expected_r?: number
  win_prob?: number
  horizon_days?: number
  entry_hint?: number
  stop_hint?: number
  confidence?: number
  status: "open" | "claimed" | "executed" | "expired" | "rejected" | "muted"
  created_at: number
  updated_at: number
}

type ApiResponse = {
  opportunities: Opportunity[]
  count: number
}

const SOURCE_COLORS: Record<string, string> = {
  splitwatch: "#9966ff",
  swing: "#33ccff",
  jarvis: "#00d4a1",
  trading_bot: "#f5c518",
}

const STATUS_COLORS: Record<string, string> = {
  open:     "#00d4a1",
  claimed:  "#33ccff",
  executed: "#9966ff",
  expired:  "#6b7280",
  rejected: "#ff5c5c",
  muted:    "#4b5563",
}

function fmtAgo(ts: number): string {
  const ms = Date.now() - ts
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

export default function OpportunitiesPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourceFilter, setSourceFilter] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<string>("open")

  const load = () => {
    const qs = new URLSearchParams()
    if (sourceFilter) qs.set("source", sourceFilter)
    if (statusFilter) qs.set("status", statusFilter)
    fetch(`/api/opportunities?${qs.toString()}`)
      .then(r => r.json())
      .then((d: ApiResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 20_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, statusFilter])

  async function setStatus(id: string, status: Opportunity["status"]) {
    await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    load()
  }

  const sources = [...new Set(data?.opportunities.map(o => o.source) ?? [])]

  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Opportunities</h1>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Unified feed of trade ideas pushed by every connected project. The allocator
        (Phase 4) reads from here when deciding where to put capital.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <FilterPill label="all sources" active={!sourceFilter} onClick={() => setSourceFilter("")} />
        {sources.map(s => (
          <FilterPill
            key={s}
            label={s}
            active={sourceFilter === s}
            color={SOURCE_COLORS[s]}
            onClick={() => setSourceFilter(s === sourceFilter ? "" : s)}
          />
        ))}
        <div style={{ width: 1, background: "#1f2937", margin: "0 8px" }} />
        {["open", "claimed", "executed", "expired", "rejected", "muted"].map(s => (
          <FilterPill
            key={s}
            label={s}
            active={statusFilter === s}
            color={STATUS_COLORS[s]}
            onClick={() => setStatusFilter(s === statusFilter ? "" : s)}
          />
        ))}
      </div>

      {loading && <div style={{ color: "#9ca3af" }}>Loading…</div>}
      {!loading && data && data.opportunities.length === 0 && (
        <div style={{ color: "#9ca3af", padding: 32, textAlign: "center" }}>
          No opportunities match these filters. Push one from a connected project to populate.
        </div>
      )}
      {!loading && data && data.opportunities.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1f2937", color: "#9ca3af", fontSize: 12, textAlign: "left" }}>
              <th style={th}>Source</th>
              <th style={th}>Asset</th>
              <th style={th}>Side</th>
              <th style={th}>Thesis</th>
              <th style={thRight}>Exp R</th>
              <th style={thRight}>Win %</th>
              <th style={thRight}>Horizon</th>
              <th style={thRight}>Entry</th>
              <th style={thRight}>Stop</th>
              <th style={thRight}>Conf</th>
              <th style={thRight}>Age</th>
              <th style={th}>Status</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.opportunities.map(o => (
              <tr key={o.id} style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={td}>
                  <span style={{ color: SOURCE_COLORS[o.source] ?? "#e5e7eb" }}>{o.source}</span>
                </td>
                <td style={td} title={o.instrument}><b>{displayInstrument(o.instrument, o.asset_class)}</b> <span style={{ color: "#6b7280" }}>{o.asset_class}</span></td>
                <td style={td}>
                  <span style={{ color: o.side === "long" ? "#00d4a1" : "#ff5c5c" }}>{o.side}</span>
                </td>
                <td style={{ ...td, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.thesis}>
                  {o.thesis}
                </td>
                <td style={tdRight}>{o.expected_r?.toFixed(2) ?? "—"}</td>
                <td style={tdRight}>{o.win_prob !== undefined ? `${(o.win_prob * 100).toFixed(0)}%` : "—"}</td>
                <td style={tdRight}>{o.horizon_days !== undefined ? `${o.horizon_days}d` : "—"}</td>
                <td style={tdRight}>{o.entry_hint?.toFixed(2) ?? "—"}</td>
                <td style={tdRight}>{o.stop_hint?.toFixed(2) ?? "—"}</td>
                <td style={tdRight}>{o.confidence !== undefined ? o.confidence.toFixed(2) : "—"}</td>
                <td style={tdRight}>{fmtAgo(o.created_at)}</td>
                <td style={td}>
                  <span style={{
                    background: STATUS_COLORS[o.status] ?? "#6b7280",
                    color: "#080d14",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                  }}>{o.status}</span>
                </td>
                <td style={td}>
                  {o.status === "open" ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <ActionBtn label="approve" color="#00d4a1" onClick={() => setStatus(o.id, "claimed")} />
                      <ActionBtn label="reject"  color="#ff5c5c" onClick={() => setStatus(o.id, "rejected")} />
                      <ActionBtn label="mute"    color="#6b7280" onClick={() => setStatus(o.id, "muted")} />
                    </div>
                  ) : (
                    <ActionBtn label="reopen" color="#33ccff" onClick={() => setStatus(o.id, "open")} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        color,
        border: `1px solid ${color}`,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        cursor: "pointer",
      }}
    >{label}</button>
  )
}

function FilterPill({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? (color ?? "#00d4a1") : "transparent",
        color: active ? "#080d14" : "#9ca3af",
        border: `1px solid ${active ? "transparent" : "#1f2937"}`,
        padding: "4px 12px",
        borderRadius: 999,
        fontSize: 12,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  )
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 500 }
const thRight: React.CSSProperties = { ...th, textAlign: "right" }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13 }
const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }
