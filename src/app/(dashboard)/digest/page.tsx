"use client"

// /digest (13.3) — the daily "what Jarvis thought and did" feed, plus the
// morning research notes. This is the page the daily push notification opens.

import { useEffect, useState } from "react"

type Digest = { date: string; headline: string; digest: string; created_at: number }
type Note = { date: string; regime: string; note: string; created_at: number }

function Markdownish({ text }: { text: string }) {
  // Minimal renderer: ## headings + bullets + paragraphs (no dependency)
  return (
    <div className="space-y-1.5">
      {text.split("\n").map((line, i) => {
        const t = line.trim()
        if (!t) return null
        if (t.startsWith("## ")) {
          return <p key={i} className="text-[10px] text-primary tracking-widest uppercase pt-2">{t.slice(3)}</p>
        }
        if (t.startsWith("* ") || t.startsWith("- ")) {
          return <p key={i} className="text-xs text-foreground/90 pl-3">· {t.slice(2)}</p>
        }
        return <p key={i} className="text-xs text-foreground/90">{t}</p>
      })}
    </div>
  )
}

export default function DigestPage() {
  const [digests, setDigests] = useState<Digest[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"digests" | "research">("digests")

  useEffect(() => {
    Promise.all([
      fetch("/api/agents/digest").then(r => r.json()).catch(() => ({ digests: [] })),
      fetch("/api/agents/research").then(r => r.json()).catch(() => ({ notes: [] })),
    ]).then(([d, n]) => {
      setDigests(d.digests ?? [])
      setNotes(n.notes ?? [])
    }).finally(() => setLoading(false))
  }, [])

  const items = tab === "digests" ? digests : notes

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4">
        <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Daily Debrief</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Evening debriefs on what Jarvis did and why · morning research notes from reputable sources
        </p>
      </div>

      <div className="flex gap-1 border border-border rounded p-0.5 w-fit">
        {(["digests", "research"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[10px] tracking-widest px-3 py-1 rounded ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t === "digests" ? "EVENING DEBRIEFS" : "MORNING RESEARCH"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground tracking-widest py-8 text-center">LOADING…</p>
      ) : items.length === 0 ? (
        <div className="border border-dashed rounded p-6 text-center text-xs text-muted-foreground">
          {tab === "digests"
            ? "No debriefs yet — the first one arrives after today's market close (push notification included)."
            : "No research notes yet — the first one arrives tomorrow pre-market."}
        </div>
      ) : (
        <div className="space-y-3">
          {tab === "digests"
            ? digests.map(d => (
                <div key={d.date} className="border border-border rounded p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-foreground">{d.headline}</p>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-3">{d.date}</span>
                  </div>
                  <Markdownish text={d.digest.split("\n").slice(1).join("\n")} />
                </div>
              ))
            : notes.map(n => (
                <div key={n.date} className="border border-border rounded p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-foreground">{n.regime}</p>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-3">{n.date}</span>
                  </div>
                  <Markdownish text={n.note} />
                </div>
              ))}
        </div>
      )}
    </div>
  )
}
