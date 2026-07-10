// Shared presentational bits for /markets sections.
// Polarity colors validated with the dataviz palette checker against the
// dark surface (#0a0f16): #00a37d (up) / #e64545 (down), neutral #6b7280.
// Signed text accompanies every colored value — polarity is never color-alone.

export const UP = "#00a37d"
export const DOWN = "#e64545"
export const NEUTRAL = "#6b7280"

export function changeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || pct === 0) return NEUTRAL
  return pct > 0 ? UP : DOWN
}

export function fmtPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "—"
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(2)}%`
}

export function fmtPrice(p: number, digits?: number): string {
  const d = digits ?? (p >= 1000 ? 0 : p >= 10 ? 2 : 4)
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
}

export const tileStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "10px 14px",
  minWidth: 132,
}

export function ErrorNote({ what }: { what: string }) {
  return (
    <div style={{ color: "#9ca3af", fontSize: 12, padding: 12, border: "1px dashed var(--border)", borderRadius: 8 }}>
      {what} unavailable right now. The provider didn't answer and nothing is cached yet — it usually recovers on the next refresh.
    </div>
  )
}
