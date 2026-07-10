"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Deliberations } from "@/components/deliberations"

type Agent = {
  id: string
  name: string
  role: string
  model_id: string
  model_family: string
  status: string
  spawned_at: number
  output_count: number
  avg_pnl_impact: number | null
  total_type1: number | null
  total_type2: number | null
}

type AgentOutput = {
  agent_id: string
  output_json: string
  created_at: number
  related_id: string | null
  pnl_impact: number | null
  type_1_error: number | null
  type_2_error: number | null
  outcome: string | null
}

const ROLE_LABEL: Record<string, string> = {
  observer: "OBSERVER",
  researcher: "RESEARCHER",
  critic: "CRITIC",
  risk_manager: "RISK MGR",
  meta_agent: "META-AGENT",
}

const STATUS_COLOR: Record<string, string> = {
  active:  "text-primary border-primary/30",
  paused:  "text-yellow-400 border-yellow-400/30",
  retired: "text-muted-foreground border-border",
}

export default function CouncilPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [outputs, setOutputs] = useState<AgentOutput[]>([])
  const [selected, setSelected] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [cycleResult, setCycleResult] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/council/agents")
      const json = await res.json()
      setAgents(json.agents ?? [])
      setOutputs(json.recentOutputs ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function runCycle() {
    setRunning(true)
    setCycleResult(null)
    try {
      const res = await fetch("/api/council/orchestrate", { method: "POST" })
      const json = await res.json()
      setCycleResult(json.message ?? JSON.stringify(json))
      await load()
    } catch (e) {
      setCycleResult(String(e))
    } finally {
      setRunning(false)
    }
  }

  const selectedOutputs = selected
    ? outputs.filter(o => o.agent_id === selected.id).slice(0, 10)
    : []

  const byRole: Record<string, Agent[]> = {}
  for (const a of agents) {
    byRole[a.role] = [...(byRole[a.role] ?? []), a]
  }

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Council</h1>
          <p className="text-xs text-muted-foreground mt-1">Agent roster, track records, manual trigger</p>
        </div>
        <Button
          size="sm"
          onClick={runCycle}
          disabled={running}
          className="text-[10px] tracking-widest bg-primary text-primary-foreground h-7"
        >
          {running ? "RUNNING..." : "RUN COUNCIL CYCLE"}
        </Button>
      </div>

      {cycleResult && (
        <div className="rounded border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs text-primary font-mono">{cycleResult}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

      <Deliberations />
        {/* Agent list */}
        <div className="space-y-4">
          {loading ? (
            <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
          ) : Object.keys(byRole).length === 0 ? (
            <div className="flex items-center justify-center h-40 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
              NO AGENTS — run seed script
            </div>
          ) : Object.entries(byRole).map(([role, roleAgents]) => (
            <div key={role}>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
                {ROLE_LABEL[role] ?? role.toUpperCase()}
              </p>
              <div className="space-y-1">
                {roleAgents.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelected(selected?.id === a.id ? null : a)}
                    className={`w-full text-left p-3 rounded border transition-colors ${
                      selected?.id === a.id
                        ? "border-primary/50 bg-primary/5"
                        : "border-border hover:border-primary/20 hover:bg-secondary/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-foreground">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{a.model_id}</p>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        {a.avg_pnl_impact !== null && (
                          <div>
                            <p className="text-[9px] text-muted-foreground">AVG P&L</p>
                            <p className={`text-xs font-medium ${
                              a.avg_pnl_impact > 0 ? "text-primary" : a.avg_pnl_impact < 0 ? "text-red-400" : "text-foreground"
                            }`}>
                              {a.avg_pnl_impact >= 0 ? "+" : ""}{a.avg_pnl_impact.toFixed(2)}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-[9px] text-muted-foreground">RUNS</p>
                          <p className="text-xs font-medium text-foreground">{a.output_count}</p>
                        </div>
                        <Badge variant="outline" className={`text-[9px] ${STATUS_COLOR[a.status] ?? ""}`}>
                          {a.status.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-muted-foreground">{a.model_family ?? a.model_id}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Agent detail / output history */}
        {selected && (
          <div className="border border-border rounded p-4 space-y-4">
            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-1">AGENT</p>
              <p className="text-sm font-medium">{selected.name}</p>
              <p className="text-[10px] text-muted-foreground">{selected.id} · {selected.model_id}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="RUNS" value={selected.output_count} />
              <MiniStat label="TYPE 1 ERRORS" value={selected.total_type1 ?? 0} />
              <MiniStat label="TYPE 2 ERRORS" value={selected.total_type2 ?? 0} />
            </div>

            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">RECENT OUTPUTS</p>
              {selectedOutputs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No outputs yet</p>
              ) : (
                <div className="space-y-2">
                  {selectedOutputs.map((o, i) => (
                    <div key={i} className="bg-secondary rounded p-2 border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-muted-foreground">
                          {new Date(o.created_at).toLocaleString()}
                        </span>
                          {o.pnl_impact !== null && (
                          <span className={`text-[9px] font-medium ${
                            o.pnl_impact > 0 ? "text-primary" : o.pnl_impact < 0 ? "text-red-400" : "text-foreground"
                          }`}>
                            {o.pnl_impact >= 0 ? "+" : ""}{o.pnl_impact.toFixed(2)}R
                          </span>
                        )}
                      </div>
                      {o.type_1_error !== null && (
                        <div className="flex gap-3 text-[9px]">
                          <span className="text-red-400">T1: {o.type_1_error}</span>
                          <span className="text-yellow-400">T2: {o.type_2_error}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-secondary rounded p-2 border border-border">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className="text-sm font-medium text-foreground mt-0.5">{String(value)}</p>
    </div>
  )
}
