"use client"

import { useEffect, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"

// react-force-graph-2d touches canvas/window -- must stay client-only,
// same reasoning the repo already has documented for lightweight-charts.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false })

type NodeType = "strategy" | "signal" | "trade" | "proposal" | "experiment" | "symbol"

interface KgNode {
  id: string
  node_type: NodeType
  label: string
  ref_table: string | null
  ref_id: string | null
  summary: string | null
  metadata_json: string | null
}
interface KgEdge {
  source_id: string
  target_id: string
  edge_type: string
}

// Matches the semantic palette already used elsewhere in the app
// (green=healthy/primary, yellow=in-progress, blue=informational/shadow,
// red=risk) rather than inventing a new one for this single page.
const NODE_COLOR: Record<NodeType, string> = {
  strategy: "#00d4a1",
  signal: "#facc15",
  trade: "#60a5fa",
  proposal: "#a78bfa",
  experiment: "#38bdf8",
  symbol: "#6b7280",
}

const LEGEND: { type: NodeType; label: string }[] = [
  { type: "strategy", label: "Strategy" },
  { type: "signal", label: "Signal" },
  { type: "trade", label: "Trade" },
  { type: "proposal", label: "Proposal" },
  { type: "experiment", label: "Experiment" },
  { type: "symbol", label: "Symbol" },
]

const DETAIL_ROUTE: Partial<Record<NodeType, (n: KgNode) => string>> = {
  strategy: () => "/strategies",
  proposal: () => "/proposals",
  symbol: (n) => `/symbol/${n.label}`,
}

export default function BrainPage() {
  const router = useRouter()
  const [nodes, setNodes] = useState<KgNode[]>([])
  const [edges, setEdges] = useState<KgEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<KgNode | null>(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/brain/graph")
      const json = await res.json()
      setNodes(json.nodes ?? [])
      setEdges(json.edges ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function exportVault() {
    setExporting(true)
    try {
      const res = await fetch("/api/brain/export")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `jarvis-brain-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const graphData = {
    nodes: nodes.map(n => ({ ...n })),
    links: edges.map(e => ({ source: e.source_id, target: e.target_id, type: e.edge_type })),
  }

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Brain</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Everything Jarvis has connected — strategies, signals, trades, proposals, experiments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="text-[10px] tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
          >
            REFRESH
          </button>
          <button
            onClick={exportVault}
            disabled={exporting || nodes.length === 0}
            className="text-[10px] tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
          >
            {exporting ? "EXPORTING..." : "EXPORT TO OBSIDIAN"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {LEGEND.map(l => (
          <div key={l.type} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLOR[l.type] }} />
            <span className="text-[9px] text-muted-foreground tracking-widest uppercase">{l.label}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-[500px]">
        <div className="lg:col-span-3 border border-border rounded relative overflow-hidden">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
            </div>
          ) : nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-center px-6">
              <div>
                <p className="text-xs text-muted-foreground tracking-widest mb-1">NOTHING CONNECTED YET</p>
                <p className="text-[10px] text-muted-foreground">
                  The graph fills in as strategies generate signals, trades close, and proposals get
                  reviewed. Trigger a sync manually via <code className="text-foreground">/api/brain/sync</code>{" "}
                  (bearer CRON_SECRET) or wait for the daily cron.
                </p>
              </div>
            </div>
          ) : (
            <ForceGraph2D
              graphData={graphData}
              nodeLabel={(n: unknown) => (n as KgNode).label}
              nodeColor={(n: unknown) => NODE_COLOR[(n as KgNode).node_type] ?? "#6b7280"}
              linkColor={() => "rgba(255,255,255,0.15)"}
              onNodeClick={(n: unknown) => setSelected(n as KgNode)}
              backgroundColor="transparent"
            />
          )}
        </div>

        <div className="border border-border rounded p-4 space-y-3">
          {selected ? (
            <>
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[9px]" style={{ color: NODE_COLOR[selected.node_type], borderColor: `${NODE_COLOR[selected.node_type]}4d` }}>
                  {selected.node_type.toUpperCase()}
                </Badge>
              </div>
              <p className="text-sm font-medium">{selected.label}</p>
              {selected.summary && (
                <p className="text-xs text-muted-foreground leading-relaxed">{selected.summary}</p>
              )}
              {DETAIL_ROUTE[selected.node_type] && (
                <button
                  onClick={() => router.push(DETAIL_ROUTE[selected.node_type]!(selected))}
                  className="text-[10px] tracking-widest text-primary hover:underline"
                >
                  VIEW IN {selected.node_type.toUpperCase()} PAGE →
                </button>
              )}
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground tracking-widest">
              CLICK A NODE TO INSPECT IT
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
