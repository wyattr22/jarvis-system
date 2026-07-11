// Plain-English rendering for audit actions and meta-decision jargon (12.10).
// Falls back to de-slugged text for unknown actions so nothing renders raw.

type Details = Record<string, unknown>

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? NaN))

const TEMPLATES: Record<string, (d: Details) => string> = {
  council_cycle_start: () => "Council convened to review the strategy",
  council_cycle_brainstorm_mode: () => "No statistically significant patterns found — Researcher is brainstorming from scratch",
  council_cycle_complete: d => `Council finished: ${String(d.overallStatus ?? "").replace(/_/g, " ")}${d.reason ? ` — ${d.reason}` : ""}`,
  opportunities_snapshot: d => `Snapshot of the opportunity feed at decision time: ${n(d.total_open) || 0} open ideas`,
  proposal_created: d => `Researcher drafted a proposal${d.hypothesis ? `: "${String(d.hypothesis).slice(0, 120)}"` : ""}`,
  proposal_failed: () => "Researcher failed to produce a usable proposal this cycle",
  plan_vetoed: d => `Risk Manager blocked the whole allocation plan${d.reason ? ` — ${d.reason}` : ""}`,
  signal_ingested: d => `New trade signal received for ${d.instrument ?? "?"} (${d.direction ?? "?"})`,
  signal_sweep_complete: d => `Scanned ${n(d.universe) || "?"} universe symbols for setups — found ${n(d.found) || 0} signal${n(d.found) === 1 ? "" : "s"}`,
  universe_scan_complete: d => `Whole-market scan: ${n(d.scanned) || "?"} symbols checked, kept the top ${n(d.universeSize) || "?"}`,
  cycle_complete: d => `Auto-execute cycle ran: ${n(d.executed) || 0} order${n(d.executed) === 1 ? "" : "s"} placed (${n(d.promoted) || 0} signals promoted to opportunities)`,
  cycle_market_closed: () => "Auto-execute skipped — market is closed",
  cycle_pdt_guard: d => `Auto-execute paused by the day-trade guard (${n(d.daytrades)} day trades used, equity under $25k)`,
  cycle_skipped_disabled: d => `Auto-execute is switched OFF — ${n(d.promoted) || 0} signal${n(d.promoted) === 1 ? "" : "s"} promoted for manual review only`,
  cycle_vetoed: d => `Auto-execute stopped by the Risk Manager${d.reason ? ` — ${d.reason}` : ""}`,
  status_change: d => `Opportunity ${d.id ?? ""} moved to "${d.status ?? "?"}"`,
  status_synced: () => "Order statuses reconciled with the broker",
  drawdown_warn: d => `Position drawdown warning${d.symbol ? ` on ${d.symbol}` : ""}`,
  drawdown_danger: d => `Position in the danger zone${d.symbol ? `: ${d.symbol}` : ""} — review it`,
  time_stop_breached: d => `Position held past its time limit${d.symbol ? `: ${d.symbol}` : ""}`,
  blocked_fetch: d => `Sandbox blocked an outbound request to ${d.host ?? "an unlisted host"}`,
  meta_agent_run: () => "Meta-agent reviewed the other agents' track records",
  meta_agent_no_decisions: () => "Meta-agent reviewed the agents and decided no changes were needed",
  meta_agent_parse_failed: () => "Meta-agent produced unparseable output — no changes made",
  meta_decisions_written: d => `Meta-agent recorded ${n(d.count) || "new"} decision${n(d.count) === 1 ? "" : "s"} about the agent team`,
  prompt_updated: d => `Agent prompt updated${d.agent ? ` for ${d.agent}` : ""} (meta-agent enforcement)`,
  weight_adjusted: d => `Agent voting weight adjusted${d.agent ? ` for ${d.agent}` : ""}`,
  apply_failed: () => "Meta-agent enforcement step failed — nothing was changed",
  ops_report: d => `Daily health check: system is ${d.status ?? "?"}${n(d.issues) ? ` (${n(d.issues)} issue${n(d.issues) === 1 ? "" : "s"})` : ""}`,
  research_note_written: d => `Morning research note written (${d.regime ?? "regime unclassified"})`,
  daily_digest_written: () => "Evening debrief written and pushed",
}

export function humanizeAction(action: string, details: Details | null): string {
  const t = TEMPLATES[action]
  if (t) {
    try { return t(details ?? {}) } catch { /* fall through */ }
  }
  return action.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())
}

/** Friendly actor names for the audit log. */
export const ACTOR_LABELS: Record<string, string> = {
  orchestrator: "Council orchestrator",
  "signal-engine": "Signal engine",
  "auto-execute": "Auto-execute",
  scanner: "Market scanner",
  allocator: "Allocator",
  "risk-manager": "Risk Manager",
  "meta-agent": "Meta-agent",
  "meta-enforcer": "Meta-enforcer",
  researcher: "Researcher",
  bot: "External bot",
  sandbox: "Sandbox",
  "allocation-outcomes": "Order reconciler",
  "time-stop-monitor": "Time-stop monitor",
  opportunities: "Opportunity feed",
  "ops-agent": "Ops agent",
  "research-agent": "Research agent",
  "digest-agent": "Digest agent",
}

// Meta-decision jargon → plain English (12.10)
export const DECISION_TYPE_PLAIN: Record<string, { label: string; explain: string }> = {
  update_prompt: { label: "Rewrite an agent's instructions", explain: "The meta-agent thinks this agent would perform better with different guidance." },
  adjust_weight: { label: "Change an agent's vote weight", explain: "How much this agent's opinion counts in council votes." },
  spawn_agent: { label: "Add a new agent", explain: "A gap in the council's coverage justifies a new specialist." },
  kill_agent: { label: "Retire an agent", explain: "This agent's track record no longer justifies its seat." },
}

export const ERROR_EXPLAIN = {
  type1: "False alarms — times the agent said \"act\" and it lost money",
  type2: "Missed winners — times the agent said \"skip\" and it would have made money",
}
