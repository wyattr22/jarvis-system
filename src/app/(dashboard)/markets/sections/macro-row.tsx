// Finally renders the intermarket snapshot that was previously computed only
// for LLM context. Values are Yahoo-sourced (delayed ~15m).

import { getIntermarketSnapshot } from "@/lib/data/intermarket"
import { tileStyle } from "./shared"

const ITEMS: { key: keyof Awaited<ReturnType<typeof getIntermarketSnapshot>>; label: string; fmt: (v: number) => string }[] = [
  { key: "dxy", label: "Dollar Index", fmt: v => v.toFixed(2) },
  { key: "yield10y", label: "10Y Yield", fmt: v => `${v.toFixed(2)}%` },
  { key: "gold", label: "Gold", fmt: v => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
  { key: "oil", label: "Oil WTI", fmt: v => `$${v.toFixed(1)}` },
  { key: "silver", label: "Silver", fmt: v => `$${v.toFixed(1)}` },
]

export async function MacroRow() {
  const snap = await getIntermarketSnapshot()
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {ITEMS.map(({ key, label, fmt }) => {
        const v = snap[key]
        return (
          <div key={key} style={{ ...tileStyle, minWidth: 110 }}>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>{v !== null ? fmt(v) : "—"}</div>
          </div>
        )
      })}
      <div style={{ alignSelf: "center", fontSize: 10, color: "#6b7280" }}>Yahoo · delayed ~15m</div>
    </div>
  )
}
