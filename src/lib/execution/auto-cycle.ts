// Auto-execution cycle (12.8) — the loop that makes the bot actually trade
// (paper). One cycle:
//
//   1. Promote fresh internal signals (signals table) into opportunities
//   2. If the auto_execute master switch is OFF → stop (promotion still ran,
//      so the /opportunities feed fills up for manual review)
//   3. Build the live allocator plan, run the Risk-Manager veto
//   4. Place up to auto_max_orders_per_cycle approved orders (paper Alpaca),
//      identical order/record path as the manual execute endpoint
//
// Every order still passes: risk caps sizing, per-opportunity veto,
// idempotent client_order_id. Kill switch: /risk-config → auto_execute.

import { getRiskConfig } from "@/lib/allocator/risk-config"
import { buildPlan } from "@/lib/allocator/scorer"
import { listOpportunities, ingestOpportunity, updateOpportunityStatus } from "@/lib/opportunities/store"
import { getAdapter } from "@/lib/brokers"
import { recordAllocation } from "@/lib/allocator/allocations"
import { auditLog } from "@/lib/guardrails/audit"
import { vetoAllocatorPlan } from "@/lib/agents/risk-manager"
import { sendPushToAll } from "@/lib/push"
import { db } from "@/lib/db/client"

const SIGNAL_MAX_AGE_MS = 6 * 60 * 60 * 1000

/**
 * Pure (14.2): derive the bracket take-profit from the opportunity's own
 * expected R. Returns undefined when inputs can't support a target — the
 * order then goes out with stop-only protection, as before.
 */
export function takeProfitFor(
  side: "long" | "short",
  entry?: number,
  stop?: number,
  expectedR?: number,
): number | undefined {
  if (!entry || !stop || !expectedR || expectedR <= 0) return undefined
  const risk = Math.abs(entry - stop)
  if (risk <= 0) return undefined
  const raw = side === "long" ? entry + expectedR * risk : entry - expectedR * risk
  if (raw <= 0) return undefined
  return Math.round(raw * 100) / 100
}

interface SignalRow {
  id: string
  instrument: string
  direction: string
  entry: number | null
  stop: number | null
  target: number | null
  confidence: number | null
  reasoning_json: string | null
}

// Exported for tests — pure signal→opportunity mapping.
export function signalToOpportunity(sig: SignalRow): Parameters<typeof ingestOpportunity>[0] | null {
  if (!sig.entry || !sig.stop || sig.entry <= 0) return null
  const risk = Math.abs(sig.entry - sig.stop)
  if (risk <= 0) return null
  const expectedR = sig.target ? Math.abs(sig.target - sig.entry) / risk : undefined
  let thesis = `signal ${sig.id}`
  try {
    const r = sig.reasoning_json ? JSON.parse(sig.reasoning_json) : null
    if (r?.text) thesis = String(r.text).slice(0, 200)
  } catch { /* keep default */ }
  return {
    source: "jarvis",
    asset_class: "equity",
    instrument: sig.instrument,
    side: sig.direction === "long" ? "long" : "short",
    thesis,
    expected_r: expectedR,
    win_prob: 0.45, // smc-ict historical baseline; outcomes feed back via reliability loop
    horizon_days: 2,
    entry_hint: sig.entry,
    stop_hint: sig.stop,
    confidence: sig.confidence ?? undefined,
    expires_at: Date.now() + 24 * 60 * 60 * 1000,
    source_payload: { signal_id: sig.id },
  }
}

async function promoteSignals(): Promise<number> {
  const res = await db.execute({
    sql: `SELECT id, instrument, direction, entry, stop, target, confidence, reasoning_json
          FROM signals WHERE status = 'pending' AND created_at > ?
          ORDER BY created_at DESC LIMIT 50`,
    args: [Date.now() - SIGNAL_MAX_AGE_MS],
  })
  let promoted = 0
  for (const row of res.rows) {
    const input = signalToOpportunity(row as unknown as SignalRow)
    if (!input) continue
    const { dedup } = await ingestOpportunity(input)
    if (!dedup) promoted++
  }
  return promoted
}

export interface AutoCycleResult {
  enabled: boolean
  promoted: number
  planned: number
  vetoed: boolean
  vetoReason?: string
  executed: { opportunity_id: string; symbol: string; ok: boolean; error?: string }[]
  tookMs: number
}

export async function runAutoCycle(): Promise<AutoCycleResult> {
  const started = Date.now()
  const promoted = await promoteSignals()
  const config = await getRiskConfig()

  const base: AutoCycleResult = {
    enabled: config.auto_execute === true,
    promoted,
    planned: 0,
    vetoed: false,
    executed: [],
    tookMs: 0,
  }

  if (!base.enabled) {
    base.tookMs = Date.now() - started
    // Heartbeat even when disarmed — the ops agent watches this actor.
    await auditLog("auto-execute", "cycle_skipped_disabled", { promoted }).catch(() => {})
    return base
  }

  const opps = await listOpportunities({ status: "open", limit: 200 })
  const equityAdapter = getAdapter("equity")

  // Market-hours gate: don't fire market orders into a closed book.
  if (!(await equityAdapter.isOpen().catch(() => false))) {
    base.tookMs = Date.now() - started
    await auditLog("auto-execute", "cycle_market_closed", { promoted }).catch(() => {})
    return base
  }

  let equity = config.equity_override ?? 0
  let positions: Awaited<ReturnType<typeof equityAdapter.positions>> = []
  if (!config.equity_override) {
    try { equity = (await equityAdapter.account()).equity } catch { /* stays 0 */ }
  }
  try { positions = await equityAdapter.positions() } catch { /* empty */ }

  const plan = buildPlan(opps, positions, equity, config)
  base.planned = plan.rows.filter(r => r.status === "approved").length

  let todayPnl = 0
  try { todayPnl = (await equityAdapter.account()).day_pnl } catch { /* 0 */ }
  const veto = vetoAllocatorPlan(plan, config, todayPnl)
  if (veto.verdict === "veto") {
    base.vetoed = true
    base.vetoReason = veto.reason
    base.tookMs = Date.now() - started
    await auditLog("auto-execute", "cycle_vetoed", { reason: veto.reason }).catch(() => {})
    return base
  }

  // PDT guard (14.2): under $25k equity a real account is restricted after
  // 3 day-trades in 5 days. Paper doesn't enforce it, but building the guard
  // now means flipping to live later doesn't change behavior.
  let daytrades = 0
  try { daytrades = (await equityAdapter.account()).daytrade_count } catch { /* 0 */ }
  if (equity < 25_000 && daytrades >= 3) {
    base.vetoed = true
    base.vetoReason = `PDT guard: ${daytrades} day trades used with equity under $25k`
    base.tookMs = Date.now() - started
    await auditLog("auto-execute", "cycle_pdt_guard", { daytrades, equity }).catch(() => {})
    return base
  }

  const perOppAllow = new Map(veto.per_opportunity.map(p => [p.opportunity_id, p]))
  const eligible = plan.rows
    .filter(r => r.status === "approved" && perOppAllow.get(r.opportunity.id)?.allow === true)
    .slice(0, Math.max(0, config.auto_max_orders_per_cycle))

  for (const row of eligible) {
    const opp = row.opportunity
    try {
      const adapter = getAdapter(opp.asset_class)
      const orderResult = await adapter.place({
        symbol: opp.instrument,
        side: opp.side === "long" ? "buy" : "sell",
        qty: row.sizing.size,
        type: "market",
        stop_price: opp.stop_hint,
        // Full bracket (14.2): exit management lives AT THE BROKER, not in
        // a monitor that might miss a cycle.
        take_profit: takeProfitFor(opp.side, opp.entry_hint, opp.stop_hint, opp.expected_r),
        time_in_force: "day",
        client_order_id: `opp_${opp.id}`,
      })
      await recordAllocation({
        opportunity_id: opp.id,
        broker: adapter.id,
        order_id: orderResult.order_id ?? null,
        allocated_usd: row.sizing.dollar_amount,
        risk_per_trade_pct: row.sizing.risk_pct_of_equity,
        decided_by: "auto",
        status: orderResult.ok ? "submitted" : "error",
        error: orderResult.error,
      })
      if (orderResult.ok) await updateOpportunityStatus(opp.id, "executed")
      base.executed.push({ opportunity_id: opp.id, symbol: opp.instrument, ok: orderResult.ok, error: orderResult.error })
    } catch (err) {
      base.executed.push({ opportunity_id: opp.id, symbol: opp.instrument, ok: false, error: String(err) })
    }
  }

  base.tookMs = Date.now() - started
  await auditLog("auto-execute", "cycle_complete", {
    promoted, planned: base.planned, executed: base.executed.length,
    ok: base.executed.filter(e => e.ok).length,
  }).catch(() => {})
  if (base.executed.some(e => e.ok)) {
    await sendPushToAll({
      title: "🤖 Auto-execute placed orders",
      body: base.executed.filter(e => e.ok).map(e => e.symbol).join(", "),
      tag: "auto-execute",
      url: "/allocations",
    }).catch(() => {})
  }
  return base
}
