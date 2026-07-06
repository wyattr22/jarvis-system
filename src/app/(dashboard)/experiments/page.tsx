"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { ShadowComparison } from "@/components/shadow-comparison"

type Experiment = {
  id: string
  proposal_id: string | null
  original_strategy_id: string
  hypothesis: string | null
  shadow_trades_required: number
  shadow_trades_completed: number
  original_pnl: number | null
  modified_pnl: number | null
  significance_p: number | null
  started_at: number
  completed_at: number | null
}


export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Experiment | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/experiments")
      const json = await res.json()
      setExperiments(json.experiments ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const running = experiments.filter(e => !e.completed_at)
  const completed = experiments.filter(e => e.completed_at)

  return (
    <div className="p-6 space-y-4">
      <ShadowComparison />
      <div className="border-b pb-4">
        <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Experiments</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Shadow A/B tests from council proposals · 50 trade minimum · p &lt; 0.05
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : experiments.length === 0 ? (
        <div className="flex items-center justify-center h-64 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
          NO EXPERIMENTS — council proposals sent to shadow mode appear here
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            {running.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
                  RUNNING ({running.length})
                </p>
                {running.map(e => <ExperimentCard key={e.id} exp={e} selected={selected} onSelect={setSelected} />)}
              </div>
            )}
            {completed.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
                  COMPLETED ({completed.length})
                </p>
                {completed.map(e => <ExperimentCard key={e.id} exp={e} selected={selected} onSelect={setSelected} />)}
              </div>
            )}
          </div>

          {selected && (
            <div className="border border-border rounded p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-muted-foreground tracking-widest mb-0.5">EXPERIMENT</p>
                  <p className="text-xs text-muted-foreground">{selected.id}</p>
                </div>
                <Badge variant="outline" className={`text-[9px] ${selected.completed_at ? "text-primary border-primary/30" : "text-blue-400 border-blue-400/30"}`}>
                  {selected.completed_at ? "COMPLETED" : "RUNNING"}
                </Badge>
              </div>

              <div>
                <p className="text-[10px] text-muted-foreground tracking-widest mb-1">HYPOTHESIS</p>
                <p className="text-xs leading-relaxed">{selected.hypothesis}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="STRATEGY" value={selected.original_strategy_id} />
                <MiniStat label="TRADES" value={`${selected.shadow_trades_completed} / ${selected.shadow_trades_required}`} />
                {selected.original_pnl !== null && (
                  <MiniStat label="ORIGINAL P&L" value={`${selected.original_pnl >= 0 ? "+" : ""}${selected.original_pnl.toFixed(3)}`} />
                )}
                {selected.modified_pnl !== null && (
                  <MiniStat label="MODIFIED P&L" value={`${selected.modified_pnl >= 0 ? "+" : ""}${selected.modified_pnl.toFixed(3)}`} />
                )}
                {selected.significance_p !== null && (
                  <MiniStat label="P-VALUE" value={selected.significance_p.toFixed(4)} />
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-muted-foreground tracking-widest">
                    PROGRESS TO MIN {selected.shadow_trades_required}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {selected.shadow_trades_completed}/{selected.shadow_trades_required}
                  </p>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min((selected.shadow_trades_completed / selected.shadow_trades_required) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ExperimentCard({
  exp, selected, onSelect
}: {
  exp: Experiment
  selected: Experiment | null
  onSelect: (e: Experiment | null) => void
}) {
  const done = !!exp.completed_at
  const pDiff = exp.modified_pnl !== null && exp.original_pnl !== null
    ? exp.modified_pnl - exp.original_pnl : null

  return (
    <button
      onClick={() => onSelect(selected?.id === exp.id ? null : exp)}
      className={`w-full text-left p-3 rounded border transition-colors ${
        selected?.id === exp.id
          ? "border-primary/50 bg-primary/5"
          : "border-border hover:border-primary/20 hover:bg-secondary/30"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground">{exp.original_strategy_id}</span>
        <Badge variant="outline" className={`text-[9px] ${done ? "text-primary border-primary/30" : "text-blue-400 border-blue-400/30"}`}>
          {done ? "COMPLETED" : "RUNNING"}
        </Badge>
      </div>
      <p className="text-xs text-foreground leading-relaxed line-clamp-2">
        {exp.hypothesis ?? "No hypothesis linked"}
      </p>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
        <span>{exp.shadow_trades_completed}/{exp.shadow_trades_required} trades</span>
        {pDiff !== null && (
          <span className={pDiff >= 0 ? "text-primary" : "text-red-400"}>
            {pDiff >= 0 ? "+" : ""}{pDiff.toFixed(3)} P&L diff
          </span>
        )}
      </div>
    </button>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-secondary border border-border rounded p-2">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className="text-xs font-medium text-foreground mt-0.5 truncate">{String(value)}</p>
    </div>
  )
}
