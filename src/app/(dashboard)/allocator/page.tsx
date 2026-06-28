"use client"

import { useState } from "react"

type SizingResult = {
  opportunity_id: string
  approved: boolean
  reason?: string
  size: number
  dollar_amount: number
  dollar_risk: number
  kelly_fraction: number
  risk_pct_of_equity: number
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
  entry_hint?: number
  stop_hint?: number
  confidence?: number
}

type PlanRow = {
  opportunity: Opportunity
  sizing: SizingResult
  score: number
  status: "approved" | "risk_blocked" | "size_zero" | "missing_data"
  block_reason?: string
}

type AllocatorPlan = {
  equity: number
  rows: PlanRow[]
  approved_count: number
  total_dollar_at_risk: number
}

type ApiResponse = {
  ok: boolean
  generated_at: number
  plan: AllocatorPlan
}

const STATUS_COLORS: Record<string, string> = {
  approved:     "#00d4a1",
  risk_blocked: "#ff5c5c",
  size_zero:    "#f5c518",
  missing_data: "#6b7280",
}

const SOURCE_COLORS: Record<string, string> = {
  splitwatch: "#9966ff",
  swing: "#33ccff",
  jarvis: "#00d4a1",
  trading_bot: "#f5c518",
}

type SortKey = "score" | "risk" | "size"

export default function AllocatorPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("score")
  const [sourceFilter, setSourceFilter] = useState<string>("")
  const [hideBlocked, setHideBlocked] = useState<boolean>(false)

  async function runPlan() {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch("/api/allocator/run", { method: "POST" })
      if (!r.ok) { setErr(`HTTP ${r.status}`); setLoading(false); return }
      setData(await r.json())
    } catch (e) {
      setErr(String(e))
    }
    setLoading(false)
  }

  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Allocator</h1>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Generates a risk-aware allocation plan from all open opportunities,
        current positions, and the risk config. Dry run — execution lands in
        a follow-up.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "center" }}>
        <button
          onClick={runPlan}
          disabled={loading}
          style={{
            background: "#00d4a1",
            color: "#080d14",
            border: "none",
            padding: "8px 16px",
            borderRadius: 6,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Running…" : data ? "Refresh Plan" : "Run Plan"}
        </button>
        {data && (
          <span style={{ color: "#9ca3af", fontSize: 13 }}>
            Equity ${data.plan.equity.toLocaleString()} · Approved {data.plan.approved_count}/{data.plan.rows.length} ·
            Total $ at risk ${data.plan.total_dollar_at_risk.toFixed(0)} ·
            generated {new Date(data.generated_at).toLocaleTimeString()}
          </span>
        )}
      </div>

      {err && <div style={{ color: "#ff5c5c", marginBottom: 16 }}>{err}</div>}

      {data && data.plan.rows.length === 0 && (
        <div style={{ color: "#9ca3af", padding: 32, textAlign: "center" }}>
          No open opportunities to allocate. Push some from a connected project.
        </div>
      )}

      {data && data.plan.rows.length > 0 && (() => {
        const sources = [...new Set(data.plan.rows.map(r => r.opportunity.source))]
        const filtered = data.plan.rows
          .filter(r => !hideBlocked || r.status === "approved")
          .filter(r => !sourceFilter || r.opportunity.source === sourceFilter)
          .sort((a, b) => {
            if (sortKey === "risk") return b.sizing.dollar_risk - a.sizing.dollar_risk
            if (sortKey === "size") return b.sizing.dollar_amount - a.sizing.dollar_amount
            return b.score - a.score  // default: score
          })
        return (
        <>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#9ca3af", fontSize: 12 }}>SORT</span>
          {(["score", "risk", "size"] as SortKey[]).map(k => (
            <FilterPill key={k} label={k} active={sortKey === k} onClick={() => setSortKey(k)} />
          ))}
          <div style={{ width: 1, background: "#1f2937", margin: "0 8px", height: 20 }} />
          <span style={{ color: "#9ca3af", fontSize: 12 }}>SOURCE</span>
          <FilterPill label="all" active={!sourceFilter} onClick={() => setSourceFilter("")} />
          {sources.map(s => (
            <FilterPill key={s} label={s} active={sourceFilter === s} color={SOURCE_COLORS[s]} onClick={() => setSourceFilter(s === sourceFilter ? "" : s)} />
          ))}
          <div style={{ width: 1, background: "#1f2937", margin: "0 8px", height: 20 }} />
          <FilterPill label={hideBlocked ? "show blocked" : "hide blocked"} active={hideBlocked} onClick={() => setHideBlocked(!hideBlocked)} />
          <span style={{ color: "#6b7280", fontSize: 12, marginLeft: 12 }}>showing {filtered.length} of {data.plan.rows.length}</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1f2937", color: "#9ca3af", fontSize: 12, textAlign: "left" }}>
              <th style={th}>Source</th>
              <th style={th}>Symbol</th>
              <th style={th}>Side</th>
              <th style={thRight}>Score</th>
              <th style={thRight}>Size</th>
              <th style={thRight}>$ Amount</th>
              <th style={thRight}>$ Risk</th>
              <th style={thRight}>Risk %</th>
              <th style={thRight}>Kelly</th>
              <th style={th}>Status</th>
              <th style={th}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const o = row.opportunity
              const s = row.sizing
              return (
                <tr key={o.id} style={{ borderBottom: "1px solid #1f2937" }}>
                  <td style={td}>
                    <span style={{ color: SOURCE_COLORS[o.source] ?? "#e5e7eb" }}>{o.source}</span>
                  </td>
                  <td style={td}><b>{o.instrument}</b> <span style={{ color: "#6b7280" }}>{o.asset_class}</span></td>
                  <td style={td}>
                    <span style={{ color: o.side === "long" ? "#00d4a1" : "#ff5c5c" }}>{o.side}</span>
                  </td>
                  <td style={tdRight}>{row.score.toFixed(2)}</td>
                  <td style={tdRight}>{s.size || "—"}</td>
                  <td style={tdRight}>{s.dollar_amount ? `$${s.dollar_amount.toFixed(0)}` : "—"}</td>
                  <td style={tdRight}>{s.dollar_risk ? `$${s.dollar_risk.toFixed(0)}` : "—"}</td>
                  <td style={tdRight}>{s.risk_pct_of_equity ? `${(s.risk_pct_of_equity * 100).toFixed(2)}%` : "—"}</td>
                  <td style={tdRight}>{s.kelly_fraction ? s.kelly_fraction.toFixed(2) : "—"}</td>
                  <td style={td}>
                    <span style={{
                      background: STATUS_COLORS[row.status] ?? "#6b7280",
                      color: "#080d14",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                    }}>{row.status}</span>
                  </td>
                  <td style={{ ...td, color: "#9ca3af", fontSize: 12, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.block_reason ?? row.sizing.reason ?? ""}>
                    {row.block_reason ?? row.sizing.reason ?? ""}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </>
        )
      })()}
    </div>
  )
}

function FilterPill({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
            style={{
              background: active ? (color ?? "#00d4a1") : "transparent",
              color: active ? "#080d14" : "#9ca3af",
              border: `1px solid ${active ? "transparent" : "#1f2937"}`,
              padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
              fontWeight: active ? 600 : 400,
            }}>
      {label}
    </button>
  )
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 500 }
const thRight: React.CSSProperties = { ...th, textAlign: "right" }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13 }
const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }
