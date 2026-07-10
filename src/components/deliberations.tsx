"use client"

// "How the council thinks" (12.9): plain-English deliberation timeline per
// proposal — Observer findings → Researcher hypothesis → walk-forward →
// each critic's take → Risk Manager verdict → final decision.

import { useEffect, useState } from "react"

type CriticScore = {
  critic?: string
  model?: string
  overall_score?: number
  critique?: string
  scores?: Record<string, number>
}

type Deliberation = {
  id: string
  strategy_id: string | null
  created_at: number
  status: string
  hypothesis: string
  walk_forward: { windows: number; avgR: number | null; avgWinRate: number | null; consistent: boolean } | null
  critics: CriticScore[] | Record<string, unknown> | null
  ensemble_confidence: number | null
  risk_verdict: string | null
  decision: string | null
  transcript: { role: string; output_type: string; output: Record<string, unknown>; created_at: number }[]
}

const STATUS_STYLE: Record<string, string> = {
  pending: "text-blue-400 border-blue-400/30",
  approved: "text-primary border-primary/30",
  promoted: "text-primary border-primary/30",
  rejected: "text-red-400 border-red-400/30",
  shadow: "text-yellow-400 border-yellow-400/30",
}

const STATUS_PLAIN: Record<string, string> = {
  pending: "WAITING FOR YOUR REVIEW",
  approved: "APPROVED",
  promoted: "PROMOTED TO LIVE",
  rejected: "REJECTED BY THE COUNCIL",
  shadow: "IN SHADOW TESTING",
}

function Step({ who, children }: { who: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="w-2 h-2 rounded-full bg-primary/60 mt-1.5" />
        <span className="flex-1 w-px bg-border" />
      </div>
      <div className="pb-4 min-w-0">
        <p className="text-[9px] text-primary tracking-widest">{who}</p>
        <div className="text-xs text-foreground/90 mt-0.5">{children}</div>
      </div>
    </div>
  )
}

function criticList(critics: Deliberation["critics"]): CriticScore[] {
  if (Array.isArray(critics)) return critics
  if (critics && typeof critics === "object") {
    return Object.entries(critics).map(([k, v]) => ({ critic: k, ...(typeof v === "object" && v !== null ? v as CriticScore : { overall_score: Number(v) }) }))
  }
  return []
}

export function Deliberations() {
  const [items, setItems] = useState<Deliberation[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/council/deliberations?limit=10")
      .then(r => r.json())
      .then(d => setItems(d.deliberations ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
        DELIBERATIONS — HOW THE COUNCIL THINKS
      </p>
      {loading ? (
        <p className="text-xs text-muted-foreground tracking-widest py-4">LOADING…</p>
      ) : items.length === 0 ? (
        <div className="border border-dashed rounded p-4 text-center text-xs text-muted-foreground">
          No council cycles yet — run one above. Each cycle records every agent&apos;s reasoning here.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(d => {
            const isOpen = open === d.id
            const critics = criticList(d.critics)
            const riskVeto = d.risk_verdict?.startsWith("veto")
            return (
              <div key={d.id} className="border border-border rounded overflow-hidden">
                <button
                  onClick={() => setOpen(isOpen ? null : d.id)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-secondary/40"
                >
                  <span className={`text-[9px] tracking-widest border rounded px-1.5 py-0.5 whitespace-nowrap ${STATUS_STYLE[d.status] ?? "text-muted-foreground border-border"}`}>
                    {STATUS_PLAIN[d.status] ?? d.status.toUpperCase()}
                  </span>
                  <span className="text-xs text-foreground flex-1 truncate">{d.hypothesis || "(no hypothesis)"}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {new Date(d.created_at).toLocaleDateString()} {isOpen ? "▲" : "▼"}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-border p-4">
                    <Step who="RESEARCHER PROPOSED">
                      {d.hypothesis}
                    </Step>
                    {d.walk_forward && (
                      <Step who="VALIDATION (WALK-FORWARD ON REAL TRADES)">
                        {d.walk_forward.windows} test windows · average {d.walk_forward.avgR ?? "?"}R per trade ·{" "}
                        {d.walk_forward.avgWinRate !== null ? `${(d.walk_forward.avgWinRate * 100).toFixed(0)}% win rate` : "win rate n/a"} ·{" "}
                        {d.walk_forward.consistent ? "results were consistent across windows ✓" : "results were INCONSISTENT across windows ✗"}
                      </Step>
                    )}
                    {critics.length > 0 && (
                      <Step who={`CRITICS (${critics.length} INDEPENDENT MODELS)`}>
                        <div className="space-y-1.5">
                          {critics.map((c, i) => (
                            <div key={i}>
                              <span className="text-muted-foreground">
                                {(c.critic ?? c.model ?? `critic ${i + 1}`)}{" "}
                                {typeof c.overall_score === "number" && `scored ${(c.overall_score * 10).toFixed(1)}/10`}:
                              </span>{" "}
                              {c.critique ?? "(no written critique)"}
                            </div>
                          ))}
                          {d.ensemble_confidence !== null && (
                            <p className="text-muted-foreground">
                              Combined confidence: {(d.ensemble_confidence * 100).toFixed(0)}%
                            </p>
                          )}
                        </div>
                      </Step>
                    )}
                    {d.risk_verdict && (
                      <Step who="RISK MANAGER">
                        <span className={riskVeto ? "text-red-400" : "text-primary"}>
                          {riskVeto ? "VETOED — " : "APPROVED — "}
                        </span>
                        {d.risk_verdict.replace(/^(veto|approve):\s*/, "")}
                      </Step>
                    )}
                    <Step who="FINAL DECISION">
                      {d.decision ?? STATUS_PLAIN[d.status] ?? d.status}
                    </Step>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
