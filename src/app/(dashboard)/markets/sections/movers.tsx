import Link from "next/link"
import { getMovers } from "@/lib/data/alpaca"
import { FreshnessBadge } from "@/components/ui/freshness-badge"
import { UP, DOWN, fmtPrice, ErrorNote } from "./shared"

function MoverList({ title, color, items }: {
  title: string
  color: string
  items: { symbol: string; price: number; percentChange: number }[]
}) {
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {items.map(m => (
            <tr key={m.symbol} style={{ borderBottom: "1px solid #111827" }}>
              <td style={{ padding: "4px 0" }}>
                <Link href={`/symbol/${m.symbol}`} style={{ color: "#e5e7eb", textDecoration: "none" }}>
                  <b>{m.symbol}</b>
                </Link>
              </td>
              <td style={{ textAlign: "right", color: "#9ca3af" }}>${fmtPrice(m.price)}</td>
              <td style={{ textAlign: "right", color, fontWeight: 600, paddingLeft: 12 }}>
                {m.percentChange >= 0 ? "+" : ""}{m.percentChange.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export async function Movers() {
  const snap = await getMovers(10)
  if (!snap) return <ErrorNote what="Movers" />
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <FreshnessBadge meta={snap.meta} />
      </div>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <MoverList title="GAINERS" color={UP} items={snap.gainers} />
        <MoverList title="LOSERS" color={DOWN} items={snap.losers} />
      </div>
    </div>
  )
}
