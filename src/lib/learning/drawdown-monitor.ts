// Position drawdown monitor.
//
// Reads live positions from the equity adapter and computes per-position
// drawdown (unrealized P&L as % of entry cost). Surfaces anything past the
// configured drawdown threshold so the user / council can react.
//
// Pure function — pass in positions + config. Cron wrapper calls the adapter.

import type { Position } from "@/lib/brokers/adapter"

export type DrawdownAlert = {
  symbol: string
  qty: number
  avg_entry_price: number
  current_unrealized_pl: number
  drawdown_pct: number          // negative if underwater
  severity: "info" | "warn" | "danger"
}

export type DrawdownConfig = {
  warn_threshold: number          // e.g. -0.03 for -3%
  danger_threshold: number        // e.g. -0.06 for -6%
}

export const DEFAULT_DRAWDOWN: DrawdownConfig = {
  warn_threshold:   -0.03,
  danger_threshold: -0.06,
}

export function computeDrawdowns(positions: Position[], config = DEFAULT_DRAWDOWN): DrawdownAlert[] {
  const alerts: DrawdownAlert[] = []
  for (const p of positions) {
    if (p.qty === 0 || p.avg_entry_price <= 0) continue
    const cost = Math.abs(p.qty) * p.avg_entry_price
    const ddPct = cost > 0 ? p.unrealized_pl / cost : 0

    let severity: DrawdownAlert["severity"] = "info"
    if (ddPct <= config.danger_threshold) severity = "danger"
    else if (ddPct <= config.warn_threshold) severity = "warn"
    else continue  // not underwater enough — skip

    alerts.push({
      symbol: p.symbol,
      qty: p.qty,
      avg_entry_price: p.avg_entry_price,
      current_unrealized_pl: p.unrealized_pl,
      drawdown_pct: ddPct,
      severity,
    })
  }
  return alerts.sort((a, b) => a.drawdown_pct - b.drawdown_pct)
}
