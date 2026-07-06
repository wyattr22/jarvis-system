// The product-level honesty artifact (Phase 11): every displayed price gets
// one of these. Pure presentational — safe in server and client components.
// Never color-alone: the badge always carries its text label.

import { freshnessOf, type QuoteMeta } from "@/lib/data/freshness"

const STYLES: Record<string, { color: string; border: string; label: string }> = {
  realtime: { color: "#00d4a1", border: "#00d4a133", label: "LIVE" },
  delayed: { color: "#f5a623", border: "#f5a62333", label: "DELAYED" },
  eod: { color: "#9ca3af", border: "#9ca3af33", label: "EOD" },
}

function tooltipFor(meta: QuoteMeta): string {
  const parts: string[] = [`source: ${meta.source}`]
  if (meta.source === "alpaca.iex") {
    parts.push("IEX feed — real-time but ~2-3% of consolidated volume; thin small-cap quotes can lag the NBBO")
  }
  if (meta.delaySeconds > 0 && meta.delaySeconds < 86400) {
    parts.push(`feed delay ~${Math.round(meta.delaySeconds / 60)}m`)
  }
  if (meta.asOf) parts.push(`as of ${meta.asOf}`)
  return parts.join(" · ")
}

export function FreshnessBadge({ meta, stale }: { meta: QuoteMeta; stale?: boolean }) {
  const freshness = freshnessOf(meta)
  const s = STYLES[freshness]
  const label = stale ? "STALE" : s.label === "DELAYED" && meta.delaySeconds > 0 && meta.delaySeconds < 3600
    ? `DELAYED ${Math.round(meta.delaySeconds / 60)}m`
    : s.label
  const color = stale ? "#9ca3af" : s.color
  return (
    <span
      title={tooltipFor(meta)}
      style={{
        color,
        border: `1px solid ${stale ? "#9ca3af33" : s.border}`,
        borderRadius: 3,
        padding: "1px 5px",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.08em",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      {label}
    </span>
  )
}
