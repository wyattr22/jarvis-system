// Daily cron: walks all submitted/in-progress allocations from the last
// 14 days, fetches the corresponding Alpaca order status, and flips them
// to filled / rejected when the broker reports a final state.
//
// We don't try to fetch P&L per row here — that comes via the existing
// /api/sync/fills cron which writes trades rows linked by signal_id (we
// reuse opportunity_id as the linkage where possible).

import { db } from "@/lib/db/client"
import { safeFetch } from "@/lib/sandbox/whitelist"
import { auditLog } from "@/lib/guardrails/audit"

export const maxDuration = 60

const ALPACA_BASE = process.env.ALPACA_PAPER === "true"
  ? "https://paper-api.alpaca.markets"
  : "https://api.alpaca.markets"

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  }
}

async function fetchOrderStatus(orderId: string): Promise<string | null> {
  try {
    const r = await safeFetch(`${ALPACA_BASE}/v2/orders/${orderId}`, {
      headers: alpacaHeaders(),
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return null
    const data = await r.json()
    return String(data.status ?? "")
  } catch {
    return null
  }
}

function mapAlpacaStatus(s: string): "submitted" | "filled" | "rejected" | "error" {
  // Alpaca order statuses → our shape
  if (["filled", "partially_filled"].includes(s)) return "filled"
  if (["canceled", "expired", "rejected", "suspended", "done_for_day"].includes(s)) return "rejected"
  if (["new", "accepted", "pending_new", "accepted_for_bidding"].includes(s)) return "submitted"
  return "submitted"
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const rows = await db.execute({
    sql: `SELECT id, opportunity_id, broker, order_id, status
          FROM allocations
          WHERE order_id IS NOT NULL
            AND status = 'submitted'
            AND decided_at >= ?
          LIMIT 100`,
    args: [cutoff],
  })

  let updated = 0
  let skipped = 0
  let unchanged = 0

  for (const row of rows.rows) {
    const r = row as unknown as { id: string; opportunity_id: string; broker: string; order_id: string; status: string }
    if (r.broker !== "alpaca") { skipped++; continue }

    const alpacaStatus = await fetchOrderStatus(r.order_id)
    if (alpacaStatus === null) { skipped++; continue }

    const mapped = mapAlpacaStatus(alpacaStatus)
    if (mapped === r.status) { unchanged++; continue }

    await db.execute({
      sql: `UPDATE allocations SET status = ? WHERE id = ?`,
      args: [mapped, r.id],
    })
    await auditLog("allocation-outcomes", "status_synced", {
      allocation_id: r.id,
      opportunity_id: r.opportunity_id,
      order_id: r.order_id,
      from: r.status,
      to: mapped,
      alpaca_status: alpacaStatus,
    })
    updated++
  }

  return Response.json({
    ok: true,
    scanned: rows.rows.length,
    updated,
    unchanged,
    skipped,
    ts: Date.now(),
  })
}
