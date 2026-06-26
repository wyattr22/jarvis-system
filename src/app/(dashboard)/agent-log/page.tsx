"use client"

import { useEffect, useState } from "react"

type AuditEntry = {
  id: string
  actor: string
  action: string
  details_json: string | null
  created_at: number
}

const ACTOR_COLOR: Record<string, string> = {
  user:    "text-primary",
  bot:     "text-blue-400",
  council: "text-yellow-400",
  system:  "text-muted-foreground",
  cron:    "text-purple-400",
}

const ACTORS = ["", "user", "bot", "council", "system", "cron"]

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [actor, setActor] = useState("")
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function load(actorFilter: string) {
    setLoading(true)
    try {
      const url = actorFilter ? `/api/audit-log?actor=${actorFilter}` : "/api/audit-log"
      const res = await fetch(url)
      const json = await res.json()
      setEntries(json.entries ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(actor) }, [actor])

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Audit Log</h1>
          <p className="text-xs text-muted-foreground mt-1">Immutable record of all system activity</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={actor}
            onChange={e => setActor(e.target.value)}
            className="text-[10px] tracking-widest bg-secondary border border-border rounded px-2 py-1 text-foreground"
          >
            {ACTORS.map(a => (
              <option key={a} value={a}>{a ? a.toUpperCase() : "ALL ACTORS"}</option>
            ))}
          </select>
          <button
            onClick={() => load(actor)}
            className="text-[10px] tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
          >
            REFRESH
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex items-center justify-center h-64 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
          NO AUDIT ENTRIES
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map(e => {
            const details = e.details_json ? (() => { try { return JSON.parse(e.details_json!) } catch { return null } })() : null
            const isExpanded = expanded === e.id
            return (
              <div
                key={e.id}
                className="border border-border rounded overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(isExpanded ? null : e.id)}
                  className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-secondary/30 transition-colors"
                >
                  <span className="text-[10px] text-muted-foreground w-32 flex-shrink-0 font-mono">
                    {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className={`text-[10px] font-medium w-16 flex-shrink-0 tracking-widest ${ACTOR_COLOR[e.actor] ?? "text-foreground"}`}>
                    {e.actor.toUpperCase()}
                  </span>
                  <span className="text-xs text-foreground">{e.action}</span>
                  {details && (
                    <span className="ml-auto text-[10px] text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
                  )}
                </button>
                {isExpanded && details && (
                  <div className="px-3 pb-3 bg-secondary/20">
                    <pre className="text-[10px] text-muted-foreground font-mono overflow-x-auto">
                      {JSON.stringify(details, null, 2)}
                    </pre>
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
