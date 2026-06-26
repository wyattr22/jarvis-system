import { getAccount, getPositions, getOrders } from "@/lib/data/alpaca"
import { db } from "@/lib/db/client"
import { auditLog } from "@/lib/guardrails/audit"

export async function GET() {
  const [account, positions, orders, strategiesResult] = await Promise.allSettled([
    getAccount(),
    getPositions(),
    getOrders("all", 20),
    db.execute({
      sql: "SELECT id, name, enabled, capital_tier, created_at FROM strategies ORDER BY created_at DESC",
      args: [],
    }),
  ])

  return Response.json({
    account: account.status === "fulfilled" ? account.value : null,
    positions: positions.status === "fulfilled" ? positions.value : [],
    orders: orders.status === "fulfilled" ? orders.value : [],
    strategies: strategiesResult.status === "fulfilled" ? strategiesResult.value.rows : [],
    error: account.status === "rejected" ? String(account.reason) : null,
  })
}

export async function PATCH(req: Request) {
  const { strategyId, action } = await req.json()
  if (!strategyId || !["pause", "resume"].includes(action)) {
    return Response.json({ error: "Invalid request" }, { status: 400 })
  }

  const enabled = action === "resume" ? 1 : 0
  await db.execute({
    sql: "UPDATE strategies SET enabled = ? WHERE id = ?",
    args: [enabled, strategyId],
  })
  await auditLog("user", `strategy_${action}`, { strategyId })

  return Response.json({ ok: true, enabled })
}
