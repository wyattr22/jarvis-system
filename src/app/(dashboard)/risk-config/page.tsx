"use client"

import { useEffect, useState } from "react"

type RiskConfig = {
  equity_override?: number | null
  max_risk_per_trade_pct: number
  max_daily_loss_pct: number
  max_open_positions: number
  max_correlated_exposure_pct: number
  asset_class_caps: Record<string, number>
  kelly_fraction_cap: number
  updated_at: number
}

export default function RiskConfigPage() {
  const [config, setConfig] = useState<RiskConfig | null>(null)
  const [draft, setDraft] = useState<RiskConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [secret, setSecret] = useState("")

  const load = () => {
    fetch("/api/admin/risk-config")
      .then(r => r.json())
      .then(d => {
        setConfig(d.config)
        setDraft(d.config)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }
  useEffect(load, [])

  async function save() {
    if (!draft || !secret) return
    setSaving(true); setMsg(null)
    try {
      const r = await fetch("/api/admin/risk-config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
        body: JSON.stringify(draft),
      })
      if (!r.ok) { setMsg(`HTTP ${r.status}`); setSaving(false); return }
      const data = await r.json()
      setConfig(data.config)
      setDraft(data.config)
      setMsg("Saved.")
    } catch (e) { setMsg(String(e)) }
    setSaving(false)
  }

  async function seedDefaults() {
    if (!secret) { setMsg("CRON_SECRET required"); return }
    setSaving(true); setMsg(null)
    const r = await fetch("/api/admin/risk-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
      body: JSON.stringify({ action: "seed" }),
    })
    if (r.ok) {
      const data = await r.json()
      setConfig(data.config); setDraft(data.config)
      setMsg("Reset to defaults.")
    } else setMsg(`HTTP ${r.status}`)
    setSaving(false)
  }

  if (loading || !config || !draft) {
    return <div style={{ padding: 24, color: "#9ca3af" }}>Loading risk config…</div>
  }

  const changed = JSON.stringify(config) !== JSON.stringify(draft)

  return (
    <div style={{ padding: 24, color: "#e5e7eb", maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Risk Config</h1>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Portfolio risk caps the allocator + sizer respect. Conservative by
        default. Updated at {new Date(config.updated_at).toLocaleString()}.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12, alignItems: "center" }}>
        <Row label="Max risk per trade (% of equity)" suffix="%">
          <input style={input} type="number" step="0.01" value={pct(draft.max_risk_per_trade_pct)}
                 onChange={e => setDraft({ ...draft, max_risk_per_trade_pct: Number(e.target.value) / 100 })} />
        </Row>
        <Row label="Max daily loss (% of equity)" suffix="%">
          <input style={input} type="number" step="0.1" value={pct(draft.max_daily_loss_pct)}
                 onChange={e => setDraft({ ...draft, max_daily_loss_pct: Number(e.target.value) / 100 })} />
        </Row>
        <Row label="Max open positions" suffix="positions">
          <input style={input} type="number" value={draft.max_open_positions}
                 onChange={e => setDraft({ ...draft, max_open_positions: Number(e.target.value) })} />
        </Row>
        <Row label="Max correlated exposure (% of equity)" suffix="%">
          <input style={input} type="number" step="1" value={pct(draft.max_correlated_exposure_pct)}
                 onChange={e => setDraft({ ...draft, max_correlated_exposure_pct: Number(e.target.value) / 100 })} />
        </Row>
        <Row label="Kelly fraction cap" suffix="(0.25 = quarter-Kelly)">
          <input style={input} type="number" step="0.05" value={draft.kelly_fraction_cap}
                 onChange={e => setDraft({ ...draft, kelly_fraction_cap: Number(e.target.value) })} />
        </Row>

        <h3 style={{ gridColumn: "1 / -1", marginTop: 16, color: "#9ca3af", fontSize: 13 }}>
          ASSET CLASS CAPS (% of equity)
        </h3>
        {Object.keys(draft.asset_class_caps).map(cls => (
          <Row key={cls} label={cls} suffix="%">
            <input style={input} type="number" step="1" value={pct(draft.asset_class_caps[cls])}
                   onChange={e => setDraft({ ...draft, asset_class_caps: { ...draft.asset_class_caps, [cls]: Number(e.target.value) / 100 } })} />
          </Row>
        ))}
      </div>

      <div style={{ marginTop: 32, borderTop: "1px solid #1f2937", paddingTop: 16 }}>
        <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8 }}>
          Saving requires the CRON_SECRET (server-side env). Paste it here — never stored:
        </p>
        <input style={{ ...input, width: 320 }} type="password" placeholder="CRON_SECRET" value={secret}
               onChange={e => setSecret(e.target.value)} />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={save} disabled={!changed || !secret || saving}
                  style={{ ...btn, background: changed && secret ? "#00d4a1" : "#1f2937", color: changed && secret ? "#080d14" : "#9ca3af" }}>
            {saving ? "Saving…" : changed ? "Save Changes" : "No Changes"}
          </button>
          <button onClick={seedDefaults} disabled={!secret || saving}
                  style={{ ...btn, background: "transparent", color: "#ff5c5c", border: "1px solid #ff5c5c" }}>
            Reset to Defaults
          </button>
          {msg && <span style={{ color: msg === "Saved." ? "#00d4a1" : "#ff5c5c", alignSelf: "center", marginLeft: 8 }}>{msg}</span>}
        </div>
      </div>
    </div>
  )
}

function pct(x: number): number { return Math.round(x * 10000) / 100 }

function Row({ label, suffix, children }: { label: string; suffix?: string; children: React.ReactNode }) {
  return (
    <>
      <label style={{ fontSize: 13 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {children}
        {suffix && <span style={{ color: "#6b7280", fontSize: 12 }}>{suffix}</span>}
      </div>
    </>
  )
}

const input: React.CSSProperties = {
  background: "#0f1923",
  color: "#e5e7eb",
  border: "1px solid #1f2937",
  padding: "6px 10px",
  borderRadius: 4,
  fontSize: 13,
  width: 100,
}

const btn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
}
