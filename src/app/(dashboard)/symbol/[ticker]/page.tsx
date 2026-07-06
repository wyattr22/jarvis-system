"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"

type Opportunity = {
  id: string; source: string; status: string; side: string; thesis: string
  expected_r?: number; win_prob?: number; confidence?: number; created_at: number
}
type Allocation = {
  id: string; broker: string; allocated_usd: number; status: string; decided_at: number
}
type Signal = {
  id: string; direction: string; entry: number; stop: number; target: number; status: string; created_at: number
}
type Memory = {
  id: string; type: string; content: string; importance: number; created_at: number
}
type Trade = {
  id: string; r_multiple: number | null; pnl: number | null; opened_at: number; closed_at: number | null
}
type Position = {
  symbol: string; qty: number; avg_entry_price: number; unrealized_pl: number; side: string
}
type TradeStats = { total: number; wins: number; losses: number; win_rate: number; total_pnl: number; avg_r: number }

type ApiResponse = {
  ticker: string
  opportunities: Opportunity[]
  allocations: Allocation[]
  signals: Signal[]
  memories: Memory[]
  trades: Trade[]
  trade_stats: TradeStats | null
  live_position: Position | null
}

function fmtAgo(ts: number): string {
  const ms = Date.now() - ts
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

export default function SymbolPage() {
  const params = useParams<{ ticker: string }>()
  const ticker = (params?.ticker ?? "").toUpperCase()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    fetch(`/api/symbol/${ticker}`)
      .then(r => r.json())
      .then((d: ApiResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ticker])

  if (loading) return <div style={{ padding: 24, color: "#9ca3af" }}>Loading {ticker}…</div>
  if (!data) return <div style={{ padding: 24, color: "#ff5c5c" }}>Failed to load.</div>

  return (
    <div style={{ padding: 24, color: "#e5e7eb" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>{ticker}</h1>
        <Link href={`/charts?symbol=${ticker}`} style={{ fontSize: 12, color: "#33ccff", textDecoration: "underline" }}>
          open chart →
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        {data.live_position && (
          <Tile label="Position" value={`${data.live_position.qty} sh`} sub={`avg $${data.live_position.avg_entry_price.toFixed(2)}, $${data.live_position.unrealized_pl.toFixed(0)} P&L`} color={data.live_position.unrealized_pl >= 0 ? "#00d4a1" : "#ff5c5c"} />
        )}
        <Tile label="Open Opps" value={String(data.opportunities.filter(o => o.status === "open").length)} sub={`${data.opportunities.length} total`} color="#33ccff" />
        <Tile label="Allocations" value={String(data.allocations.length)} sub={`${data.allocations.filter(a => a.status === "filled").length} filled`} color="#9966ff" />
        <Tile label="Signals" value={String(data.signals.length)} color="#f5c518" />
        <Tile label="Memories" value={String(data.memories.length)} color="#6b7280" />
        {data.trade_stats && (
          <>
            <Tile label="Trades" value={String(data.trade_stats.total)} sub={`${data.trade_stats.wins}W/${data.trade_stats.losses}L`} />
            <Tile label="Total P&L" value={`$${data.trade_stats.total_pnl.toFixed(0)}`} color={data.trade_stats.total_pnl >= 0 ? "#00d4a1" : "#ff5c5c"} />
            <Tile label="Avg R" value={data.trade_stats.avg_r.toFixed(2)} color={data.trade_stats.avg_r >= 0 ? "#00d4a1" : "#ff5c5c"} />
          </>
        )}
      </div>

      <Section title="OPPORTUNITIES" empty="No opportunities for this ticker.">
        {data.opportunities.map(o => (
          <div key={o.id} style={row}>
            <div style={{ width: 100, color: "#9ca3af" }}>{o.source}</div>
            <div style={{ width: 60, color: o.side === "long" ? "#00d4a1" : "#ff5c5c" }}>{o.side}</div>
            <div style={{ flex: 1, color: "#e5e7eb" }}>{o.thesis.slice(0, 120)}</div>
            <div style={{ width: 80, textAlign: "right", color: "#9ca3af" }}>{o.status}</div>
            <div style={{ width: 60, textAlign: "right", color: "#6b7280" }}>{fmtAgo(o.created_at)}</div>
          </div>
        ))}
      </Section>

      <Section title="ALLOCATIONS" empty="Never allocated to this ticker.">
        {data.allocations.map(a => (
          <div key={a.id} style={row}>
            <div style={{ width: 100, color: "#9ca3af" }}>{a.broker}</div>
            <div style={{ flex: 1, color: "#e5e7eb" }}>${a.allocated_usd.toFixed(0)}</div>
            <div style={{ width: 80, textAlign: "right", color: "#9ca3af" }}>{a.status}</div>
            <div style={{ width: 60, textAlign: "right", color: "#6b7280" }}>{fmtAgo(a.decided_at)}</div>
          </div>
        ))}
      </Section>

      <Section title="MEMORIES" empty="No tagged memories yet.">
        {data.memories.map(m => (
          <div key={m.id} style={{ ...row, alignItems: "flex-start" }}>
            <div style={{ width: 100, color: "#9ca3af" }}>{m.type}</div>
            <div style={{ flex: 1, color: "#e5e7eb", fontSize: 12 }}>{m.content}</div>
            <div style={{ width: 60, textAlign: "right", color: "#6b7280" }}>imp={m.importance}</div>
          </div>
        ))}
      </Section>
    </div>
  )
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#0f1923", padding: 16, borderRadius: 6, border: "1px solid #1f2937" }}>
      <div style={{ fontSize: 11, color: "#9ca3af", letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color ?? "#e5e7eb", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children]
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 12, color: "#9ca3af", letterSpacing: 0.5, marginBottom: 8 }}>{title}</h3>
      <div style={{ background: "#0f1923", borderRadius: 6, border: "1px solid #1f2937" }}>
        {arr.length === 0 || (arr.length === 1 && !arr[0]) ? (
          <div style={{ padding: 24, color: "#6b7280", fontSize: 12, textAlign: "center" }}>{empty}</div>
        ) : children}
      </div>
    </div>
  )
}

const row: React.CSSProperties = {
  display: "flex",
  gap: 12,
  padding: "8px 12px",
  fontSize: 12,
  borderBottom: "1px solid #1f2937",
  alignItems: "center",
}
