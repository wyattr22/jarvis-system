"use client"

import { useEffect, useState } from "react"

type Memory = {
  id: string
  type: "fact" | "insight" | "pattern" | "preference"
  content: string
  tags: string[]
  importance: number
  source: "user_said" | "jarvis_observed" | "system"
  created_at: number
  last_accessed: number
  access_count: number
}

const TYPE_COLOR: Record<string, string> = {
  fact:       "text-blue-400 border-blue-400/30",
  insight:    "text-primary border-primary/30",
  pattern:    "text-yellow-400 border-yellow-400/30",
  preference: "text-purple-400 border-purple-400/30",
}

const SOURCE_LABEL: Record<string, string> = {
  user_said:        "you said",
  jarvis_observed:  "jarvis observed",
  system:           "system",
}

function timeAgo(ts: number) {
  const d = Date.now() - ts
  const h = Math.floor(d / 3600000)
  const days = Math.floor(d / 86400000)
  if (days > 1) return `${days}d ago`
  if (h > 0) return `${h}h ago`
  return "just now"
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | Memory["type"]>("all")
  const [search, setSearch] = useState<string>("")
  const [tagFilter, setTagFilter] = useState<string>("")
  const [editing, setEditing] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [newContent, setNewContent] = useState("")
  const [newType, setNewType] = useState<Memory["type"]>("fact")
  const [newTags, setNewTags] = useState("")
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch("/api/memories?limit=2000")
    const json = await res.json()
    setMemories(json.memories ?? [])
    setTotal(json.total ?? (json.memories?.length ?? 0))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id: string) {
    await fetch("/api/memories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    setMemories(m => m.filter(x => x.id !== id))
  }

  async function saveEdit(id: string) {
    await fetch("/api/memories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: editContent }),
    })
    setMemories(m => m.map(x => x.id === id ? { ...x, content: editContent } : x))
    setEditing(null)
  }

  async function addMemory() {
    if (!newContent.trim()) return
    setAdding(true)
    const tags = newTags.split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
    await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent, type: newType, tags, importance: 7 }),
    })
    setNewContent("")
    setNewTags("")
    await load()
    setAdding(false)
  }

  const allTags = [...new Set(memories.flatMap(m => m.tags ?? []))].sort()
  const filtered = memories
    .filter(m => filter === "all" || m.type === filter)
    .filter(m => !tagFilter || (m.tags ?? []).includes(tagFilter))
    .filter(m => !search.trim() || m.content.toLowerCase().includes(search.trim().toLowerCase()))
  const types: Memory["type"][] = ["fact", "insight", "pattern", "preference"]

  return (
    <div className="p-6 space-y-4">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Jarvis Memory</h1>
          <p className="text-xs text-muted-foreground mt-1">
            showing {memories.length} of {total} memories · auto-extracted from every conversation
          </p>
        </div>
        <button onClick={load} className="text-[10px] tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1">
          REFRESH
        </button>
      </div>

      {/* Type filter */}
      <div className="flex items-center gap-1.5">
        {["all", ...types].map(t => (
          <button
            key={t}
            onClick={() => setFilter(t as typeof filter)}
            className={`text-[9px] tracking-widest px-2 py-0.5 rounded border transition-colors ${
              filter === t ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">{filtered.length} shown</span>
      </div>

      {/* Search + tag filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          placeholder="search memory content…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs bg-background border border-border rounded px-2 py-1 w-64 focus:outline-none focus:border-primary"
        />
        {tagFilter && (
          <button onClick={() => setTagFilter("")}
                  className="text-[10px] tracking-widest px-2 py-0.5 rounded border border-primary text-primary bg-primary/10">
            #{tagFilter} ×
          </button>
        )}
        {allTags.length > 0 && !tagFilter && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground">tags:</span>
            {allTags.slice(0, 12).map(t => (
              <button key={t} onClick={() => setTagFilter(t)}
                      className="text-[10px] tracking-widest px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground">
                #{t}
              </button>
            ))}
            {allTags.length > 12 && <span className="text-[10px] text-muted-foreground">+{allTags.length - 12}</span>}
          </div>
        )}
      </div>

      {/* Add memory */}
      <div className="border border-border rounded p-3 space-y-2">
        <p className="text-[10px] text-muted-foreground tracking-widest">TEACH JARVIS SOMETHING</p>
        <textarea
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          placeholder="e.g. I only trade the first 2 hours of the session, I prefer TSLA and NVDA..."
          className="w-full text-xs bg-secondary border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground resize-none"
          rows={2}
        />
        <div className="flex items-center gap-2">
          <select
            value={newType}
            onChange={e => setNewType(e.target.value as Memory["type"])}
            className="text-[10px] bg-secondary border border-border rounded px-2 py-1 text-foreground tracking-widest"
          >
            {types.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
          </select>
          <input
            value={newTags}
            onChange={e => setNewTags(e.target.value.toUpperCase())}
            placeholder="TAGS (TSLA, entries...)"
            className="text-[10px] bg-secondary border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground flex-1 tracking-widest"
          />
          <button
            onClick={addMemory}
            disabled={adding || !newContent.trim()}
            className="text-[10px] tracking-widest border border-primary text-primary rounded px-3 py-1 hover:bg-primary/10 disabled:opacity-40 transition-colors"
          >
            {adding ? "..." : "SAVE"}
          </button>
        </div>
      </div>

      {/* Memory list */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-40 border border-dashed rounded text-muted-foreground text-xs tracking-widest">
          NO MEMORIES YET — START TALKING TO JARVIS
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(m => (
            <div key={m.id} className="border border-border rounded p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] border rounded px-1.5 py-0.5 tracking-widest ${TYPE_COLOR[m.type]}`}>
                    {m.type.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {SOURCE_LABEL[m.source]} · {timeAgo(m.created_at)}
                  </span>
                  {m.importance >= 8 && (
                    <span className="text-[9px] text-yellow-400 border border-yellow-400/30 rounded px-1">PINNED</span>
                  )}
                  {m.tags.map(tag => (
                    <span key={tag} className="text-[9px] text-primary tracking-widest">{tag}</span>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setEditing(m.id); setEditContent(m.content) }}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => remove(m.id)}
                    className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>

              {editing === m.id ? (
                <div className="space-y-1">
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full text-xs bg-secondary border border-primary/50 rounded px-2 py-1.5 text-foreground resize-none"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(m.id)} className="text-[10px] text-primary hover:underline">save</button>
                    <button onClick={() => setEditing(null)} className="text-[10px] text-muted-foreground hover:text-foreground">cancel</button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-foreground leading-relaxed">{m.content}</p>
              )}

              <p className="text-[9px] text-muted-foreground">
                accessed {m.access_count}× · importance {m.importance}/10
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
