"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

type MetaDecision = {
  id: string
  target_agent_id: string
  target_agent_name: string | null
  decision_type: string
  rationale: string
  proposed_change_json: string | null
  evidence_json: string | null
  status: string
  created_at: number
}

const TYPE_COLOR: Record<string, string> = {
  update_prompt:  "text-blue-400 border-blue-400/30",
  adjust_weight:  "text-yellow-400 border-yellow-400/30",
  spawn_agent:    "text-primary border-primary/30",
  kill_agent:     "text-red-400 border-red-400/30",
}

const STATUS_COLOR: Record<string, string> = {
  pending:  "text-yellow-400 border-yellow-400/30",
  applied:  "text-primary border-primary/30",
  rejected: "text-red-400 border-red-400/30",
}

export default function MetaDecisionsPage() {
  const [decisions, setDecisions] = useState<MetaDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<MetaDecision | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/meta-decisions")
      const json = await res.json()
      setDecisions(json.decisions ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4">
        <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Meta Decisions</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Meta-Agent proposals: prompt updates, weight adjustments, spawn/kill agents
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : decisions.length === 0 ? (
        <div className="flex items-center justify-center h-64 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
          NO META-DECISIONS — Meta-Agent runs weekly after 90 days
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            {decisions.map(d => (
              <button
                key={d.id}
                onClick={() => setSelected(selected?.id === d.id ? null : d)}
                className={`w-full text-left p-3 rounded border transition-colors ${
                  selected?.id === d.id
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:border-primary/20 hover:bg-secondary/30"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">
                    {d.target_agent_name ?? d.target_agent_id}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[9px] ${TYPE_COLOR[d.decision_type] ?? ""}`}>
                      {d.decision_type.replace(/_/g, " ").toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className={`text-[9px] ${STATUS_COLOR[d.status] ?? ""}`}>
                      {d.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-foreground leading-relaxed line-clamp-2">{d.rationale}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(d.created_at).toLocaleDateString()}
                </p>
              </button>
            ))}
          </div>

          {selected && (
            <div className="border border-border rounded p-4 space-y-4">
              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-1">TARGET</p>
                <p className="text-sm font-medium">{selected.target_agent_name ?? selected.target_agent_id}</p>
              </div>

              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-1">RATIONALE</p>
                <p className="text-xs leading-relaxed">{selected.rationale}</p>
              </div>

              {selected.evidence_json && (() => {
                try {
                  const ev = JSON.parse(selected.evidence_json)
                  return (
                    <div>
                      <p className="text-[10px] text-muted-foreground tracking-widest mb-2">EVIDENCE</p>
                      <div className="grid grid-cols-2 gap-2">
                        <MiniStat label="N OUTCOMES" value={ev.n_outcomes} />
                        <MiniStat label="ACCURACY" value={`${(ev.accuracy * 100).toFixed(0)}%`} />
                        <MiniStat label="TYPE 1 ERRORS" value={ev.type_1_errors} />
                        <MiniStat label="TYPE 2 ERRORS" value={ev.type_2_errors} />
                      </div>
                    </div>
                  )
                } catch { return null }
              })()}

              {selected.proposed_change_json && (() => {
                try {
                  const change = JSON.parse(selected.proposed_change_json)
                  return (
                    <div>
                      <p className="text-[10px] text-muted-foreground tracking-widest mb-1">PROPOSED CHANGE</p>
                      <pre className="text-[10px] text-muted-foreground font-mono bg-secondary rounded p-2 overflow-x-auto">
                        {JSON.stringify(change, null, 2)}
                      </pre>
                    </div>
                  )
                } catch { return null }
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-secondary border border-border rounded p-2">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className="text-xs font-medium text-foreground mt-0.5">{String(value)}</p>
    </div>
  )
}
