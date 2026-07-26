import { db } from "@/lib/db/client"
import { runObserver } from "./observer"
import { runResearcher } from "./researcher"
import { getOpportunitiesForCouncil } from "./opportunities-context"
import { runCriticEnsemble } from "./critic"
import { runRiskManager } from "./risk-manager"
import { runMetaAgent } from "./meta-agent"
import { runWalkForward, backtestWalkForward, type InMemoryWalkForwardResult } from "@/lib/validation/walk-forward"
import { backtestUniverse } from "@/lib/strategy-engine/backtest-runner"
import { getActiveUniverse } from "@/lib/universe/store"
import { auditLog } from "@/lib/guardrails/audit"
import { recordAgentOutput } from "./transcript"

const NEW_STRATEGY_BACKTEST_SYMBOL_COUNT = 30

export interface OrchestrationResult {
  proposalId: string
  hypothesis: string
  walkForwardPass: boolean
  criticEnsembleScore: number
  criticAgreement: number
  riskVerdict: "approve" | "veto"
  lowDiversity: boolean
  overallStatus: "ready_for_review" | "auto_rejected" | "needs_shadow"
  reason: string
}

export async function runFullCouncilCycle(strategyId: string): Promise<OrchestrationResult | null> {
  await auditLog("orchestrator", "council_cycle_start", { strategyId })

  // Step 1: Run Observer — if no patterns yet, Researcher will brainstorm instead
  const patterns = await runObserver()
  if (patterns.length === 0) {
    await auditLog("orchestrator", "council_cycle_brainstorm_mode", { strategyId })
  }

  // Cross-project opportunities snapshot for the council's awareness.
  // Logged into audit_log so we can correlate council outcomes with the
  // opportunity feed state at decision time.
  const oppsCtx = await getOpportunitiesForCouncil().catch(() => null)
  if (oppsCtx) {
    await auditLog("orchestrator", "opportunities_snapshot", {
      total_open: oppsCtx.total_open,
      by_source: oppsCtx.by_source,
      by_asset_class: oppsCtx.by_asset_class,
      top_count: oppsCtx.top.length,
    })
  }

  // Step 2: Researcher drafts proposal
  const proposal = await runResearcher(strategyId)
  if (!proposal) return null

  // Get the proposal ID we just created
  const proposalRow = await db.execute({
    sql: "SELECT id FROM proposals WHERE strategy_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [strategyId],
  })
  const proposalId = proposalRow.rows[0]?.id as string
  if (!proposalId) return null

  // Deliberation transcript (12.9): every stage becomes an agent_outputs row
  await recordAgentOutput("observer", "patterns", {
    pattern_count: patterns.length,
    patterns: patterns.slice(0, 5),
    mode: patterns.length === 0 ? "brainstorm (no significant patterns found)" : "pattern-driven",
  }, proposalId)
  await recordAgentOutput("researcher", "proposal", {
    hypothesis: proposal.hypothesis,
    proposed_change: proposal.proposed_change,
    evidence: proposal.evidence,
  }, proposalId)

  // Step 3: Walk-forward validation
  //
  // A "new_strategy" proposal (Phase 20) is a brand-new candidate with zero
  // live trade history by definition -- runWalkForward's trade-history query
  // requires 50+ historical trades to even attempt validation, which isn't
  // "hard but fair" for something that's never traded, it's a wall. Instead:
  // insert a draft strategies row (capital_tier 0 -- shadow, enabled 0) and
  // validate via a fresh historical backtest through the exact same
  // interpreter path a human clicking "WALK-FORWARD" would use.
  const isNewStrategy = proposal.proposed_change.type === "new_strategy"
  let wfResult: InMemoryWalkForwardResult | Awaited<ReturnType<typeof runWalkForward>>
  let draftStrategyId: string | null = null

  if (isNewStrategy && proposal.proposed_change.type === "new_strategy") {
    const definition = proposal.proposed_change.strategy_definition
    draftStrategyId = definition.id
    await db.execute({
      sql: `INSERT OR REPLACE INTO strategies
              (id, name, description, rules_json, enabled, weight, config_json, capital_tier, created_at)
            VALUES (?, ?, ?, NULL, 0, 1.0, NULL, 0, ?)`,
      args: [
        definition.id,
        definition.id,
        proposal.proposed_change.description,
        Date.now(),
      ],
    })
    // definition_json isn't in the base INSERT column list above (it's a
    // lazily-migrated column, per Phase 17's dispatch.ts convention) --
    // set it via UPDATE so this insert works whether or not the column
    // exists yet on a fresh DB.
    try {
      await db.execute(`ALTER TABLE strategies ADD COLUMN definition_json TEXT`)
    } catch { /* already exists */ }
    await db.execute({
      sql: `UPDATE strategies SET definition_json = ? WHERE id = ?`,
      args: [JSON.stringify(definition), definition.id],
    })
    await auditLog("orchestrator", "new_strategy_draft_created", {
      strategyId: definition.id, capital_tier: 0, enabled: 0,
    })

    const symbols = definition.universe === "active_scan_universe"
      ? await getActiveUniverse(NEW_STRATEGY_BACKTEST_SYMBOL_COUNT)
      : definition.universe
    const trades = await backtestUniverse(definition.id, symbols).catch(() => [])
    wfResult = backtestWalkForward(trades)
  } else {
    wfResult = await runWalkForward(strategyId)
  }

  const walkForwardPass = wfResult.passedMinWindows && wfResult.consistent && wfResult.avgR > 0

  await db.execute({
    sql: "UPDATE proposals SET walk_forward_result_json = ? WHERE id = ?",
    args: [JSON.stringify(wfResult), proposalId],
  })
  await recordAgentOutput("validator", "walk_forward", {
    passed: walkForwardPass,
    windows: wfResult.windows.length,
    avgR: wfResult.avgR,
    avgWinRate: wfResult.avgWinRate,
    consistent: wfResult.consistent,
    source: isNewStrategy ? "fresh_backtest (new_strategy candidate, no live history exists yet)" : "live_trade_history",
  }, proposalId)

  // Step 4: Critics in parallel
  const criticResult = await runCriticEnsemble(proposal)

  await db.execute({
    sql: "UPDATE proposals SET critic_scores_json = ?, ensemble_confidence = ? WHERE id = ?",
    args: [JSON.stringify(criticResult.scores), criticResult.ensembleScore, proposalId],
  })
  await recordAgentOutput("critic", "critiques", {
    ensemble_score: criticResult.ensembleScore,
    agreement: criticResult.agreement,
    low_diversity: criticResult.lowDiversity,
    critics: criticResult.scores,
  }, proposalId)

  // Step 5: Risk Manager
  const account = await getAccountEquity()
  const riskResult = await runRiskManager(proposal, account)

  await db.execute({
    sql: "UPDATE proposals SET risk_verdict = ? WHERE id = ?",
    args: [`${riskResult.verdict}: ${riskResult.reason}`, proposalId],
  })
  await recordAgentOutput("risk-manager", "risk_verdict", {
    verdict: riskResult.verdict,
    reason: riskResult.reason,
  }, proposalId)

  // Step 6: Orchestrator synthesis
  let overallStatus: OrchestrationResult["overallStatus"]
  let reason = ""

  if (riskResult.verdict === "veto") {
    overallStatus = "auto_rejected"
    reason = `Risk veto: ${riskResult.reason}`
    await db.execute({
      sql: "UPDATE proposals SET status = 'rejected', reviewer_notes = ? WHERE id = ?",
      args: [reason, proposalId],
    })
  } else if (!walkForwardPass) {
    overallStatus = "auto_rejected"
    reason = `Walk-forward failed: consistent=${wfResult.consistent}, windows=${wfResult.windows.length}`
    await db.execute({
      sql: "UPDATE proposals SET status = 'rejected', reviewer_notes = ? WHERE id = ?",
      args: [reason, proposalId],
    })
  } else if (criticResult.agreement < 0.5 || criticResult.lowDiversity) {
    overallStatus = "needs_shadow"
    reason = `Low critic confidence (agreement=${criticResult.agreement.toFixed(2)}, diversity=${!criticResult.lowDiversity})`
    await db.execute({
      sql: "UPDATE proposals SET status = 'shadow', reviewer_notes = ? WHERE id = ?",
      args: [reason, proposalId],
    })
  } else {
    overallStatus = "ready_for_review"
    reason = `Passed all gates. Score=${criticResult.ensembleScore.toFixed(2)}, agreement=${criticResult.agreement.toFixed(2)}`
    await db.execute({
      sql: "UPDATE proposals SET status = 'pending', reviewer_notes = ? WHERE id = ?",
      args: [reason, proposalId],
    })
  }

  await recordAgentOutput("orchestrator", "synthesis", {
    overall_status: overallStatus,
    reason,
  }, proposalId)

  await auditLog("orchestrator", "council_cycle_complete", {
    strategyId, proposalId, overallStatus, reason,
  })

  // Monthly meta-agent run: only if no meta decision exists this calendar month
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  try {
    const recentMeta = await db.execute({
      sql: "SELECT id FROM meta_decisions WHERE created_at > ? LIMIT 1",
      args: [startOfMonth.getTime()],
    })
    if (recentMeta.rows.length === 0) {
      await runMetaAgent()
      await auditLog("orchestrator", "meta_agent_run", { strategyId })
    }
  } catch { /* non-fatal — meta-agent failure shouldn't break council */ }

  return {
    proposalId,
    hypothesis: proposal.hypothesis,
    walkForwardPass,
    criticEnsembleScore: criticResult.ensembleScore,
    criticAgreement: criticResult.agreement,
    riskVerdict: riskResult.verdict,
    lowDiversity: criticResult.lowDiversity,
    overallStatus,
    reason,
  }
}

async function getAccountEquity(): Promise<number> {
  // Default to 10k until Alpaca account is live
  return Number(process.env.ACCOUNT_EQUITY ?? 10000)
}
