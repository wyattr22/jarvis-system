"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Proposal = {
  id: string
  strategy_id: string
  hypothesis: string
  ensemble_confidence: number | null
  risk_verdict: string | null
  status: string
  reviewer_notes: string | null
  created_at: number
  walk_forward_result_json: string | null
  stability_score: number | null
  proposed_change_json: string | null
}

/** Phase 20: "new_strategy" proposals carry a full StrategyDefinition
 *  instead of a parameter/filter tweak — surfaced distinctly since it's a
 *  materially different (and higher-stakes) kind of proposal to review. */
function parseProposedChange(json: string | null): { type: string; description?: string; strategy_definition?: unknown } | null {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

const STATUS_COLOR: Record<string, string> = {
  pending:  "text-yellow-400 border-yellow-400/30",
  approved: "text-primary border-primary/30",
  rejected: "text-red-400 border-red-400/30",
  shadow:   "text-blue-400 border-blue-400/30",
  promoted: "text-primary border-primary/30",
}

export default function ProposalsPage() {
  const [tab, setTab] = useState("pending")
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Proposal | null>(null)
  const [notes, setNotes] = useState("")
  const [acting, setActing] = useState(false)

  async function load(status: string) {
    setLoading(true)
    const res = await fetch(`/api/proposals?status=${status}`)
    const json = await res.json()
    setProposals(json.proposals ?? [])
    setLoading(false)
  }

  useEffect(() => { load(tab) }, [tab])

  async function act(proposalId: string, status: string) {
    setActing(true)
    await fetch(`/api/proposals/${proposalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reviewerNotes: notes }),
    })
    setSelected(null)
    setNotes("")
    await load(tab)
    setActing(false)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Proposals</h1>
          <p className="text-xs text-muted-foreground mt-1">Agent proposals — approve, reject, or send to shadow testing</p>
        </div>
        <Tabs value={tab} onValueChange={v => { setTab(v); setSelected(null) }}>
          <TabsList className="bg-secondary">
            {["pending", "shadow", "approved", "rejected"].map(s => (
              <TabsTrigger key={s} value={s} className="text-[10px] tracking-widest uppercase">{s}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          {loading ? (
            <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
          ) : proposals.length === 0 ? (
            <div className="flex items-center justify-center h-40 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
              NO {tab.toUpperCase()} PROPOSALS
            </div>
          ) : proposals.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelected(p); setNotes(p.reviewer_notes ?? "") }}
              className={`w-full text-left p-3 rounded border transition-colors ${
                selected?.id === p.id
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-primary/20 hover:bg-secondary/30"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-muted-foreground tracking-widest">{p.strategy_id}</span>
                <div className="flex items-center gap-2">
                  {parseProposedChange(p.proposed_change_json)?.type === "new_strategy" && (
                    <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">
                      NEW STRATEGY
                    </Badge>
                  )}
                  {p.ensemble_confidence !== null && (
                    <span className="text-[10px] text-primary">{(p.ensemble_confidence * 100).toFixed(0)}%</span>
                  )}
                  <Badge variant="outline" className={`text-[9px] ${STATUS_COLOR[p.status] ?? ""}`}>
                    {p.status.toUpperCase()}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-foreground leading-relaxed line-clamp-2">{p.hypothesis}</p>
              {p.risk_verdict && (
                <p className={`text-[10px] mt-1 ${p.risk_verdict.startsWith("veto") ? "text-red-400" : "text-primary"}`}>
                  {p.risk_verdict.slice(0, 80)}
                </p>
              )}
            </button>
          ))}
        </div>

        {selected && (
          <div className="border rounded p-4 space-y-4">
            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-1">HYPOTHESIS</p>
              <p className="text-xs leading-relaxed">{selected.hypothesis}</p>
            </div>

            {(() => {
              const change = parseProposedChange(selected.proposed_change_json)
              if (change?.type !== "new_strategy") return null
              return (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[10px] text-muted-foreground tracking-widest">STRATEGY DEFINITION</p>
                    <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">NEW STRATEGY CANDIDATE</Badge>
                  </div>
                  {change.description && <p className="text-xs text-muted-foreground mb-2">{change.description}</p>}
                  <pre className="text-[10px] text-muted-foreground font-mono bg-secondary rounded p-2 overflow-x-auto max-h-64">
                    {JSON.stringify(change.strategy_definition, null, 2)}
                  </pre>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Approving inserts this as a strategy at capital_tier 0 (shadow) — it generates signals for
                    observation only. The shadow-tier gate in auto-cycle.ts blocks it from ever reaching a
                    broker regardless of what the allocator/risk-manager approve. Promotion to a trading tier
                    is a separate, later decision.
                  </p>
                </div>
              )
            })()}

            {selected.walk_forward_result_json && (() => {
              try {
                const wf = JSON.parse(selected.walk_forward_result_json)
                return (
                  <div>
                    <p className="text-[10px] text-muted-foreground tracking-widest mb-1">WALK-FORWARD</p>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="AVG R" value={wf.avgR?.toFixed(2) ?? "—"} />
                      <Stat label="WIN RATE" value={wf.avgWinRate ? `${(wf.avgWinRate * 100).toFixed(0)}%` : "—"} />
                      <Stat label="WINDOWS" value={wf.windows?.length ?? "—"} ok={wf.passedMinWindows} />
                    </div>
                  </div>
                )
              } catch { return null }
            })()}

            <div className="grid grid-cols-2 gap-2">
              {selected.ensemble_confidence !== null && (
                <Stat label="ENSEMBLE" value={`${(selected.ensemble_confidence * 100).toFixed(0)}%`} />
              )}
              {selected.stability_score !== null && (
                <Stat label="STABILITY" value={`${(selected.stability_score * 100).toFixed(0)}%`} />
              )}
            </div>

            {selected.risk_verdict && (
              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-1">RISK VERDICT</p>
                <p className={`text-xs ${selected.risk_verdict.startsWith("veto") ? "text-red-400" : "text-primary"}`}>
                  {selected.risk_verdict}
                </p>
              </div>
            )}

            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-1">REVIEWER NOTES</p>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes..."
                className="text-xs h-16 bg-secondary border-border"
              />
            </div>

            {tab === "pending" && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => act(selected.id, "approved")}
                  disabled={acting}
                  className="flex-1 bg-primary text-primary-foreground text-[10px] tracking-widest"
                >
                  APPROVE
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act(selected.id, "shadow")}
                  disabled={acting}
                  className="flex-1 text-[10px] tracking-widest text-blue-400 border-blue-400/30"
                >
                  SHADOW
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act(selected.id, "rejected")}
                  disabled={acting}
                  className="flex-1 text-[10px] tracking-widest text-red-400 border-red-400/30"
                >
                  REJECT
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, ok }: { label: string; value: string | number; ok?: boolean }) {
  return (
    <div className="bg-secondary rounded p-2">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className={`text-sm font-medium ${ok === false ? "text-red-400" : ok === true ? "text-primary" : "text-foreground"}`}>
        {String(value)}
      </p>
    </div>
  )
}
