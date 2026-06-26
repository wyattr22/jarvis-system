import { createClient } from "@libsql/client"

const db = createClient({ url: "file:./jarvis.db" })

const strategies = [
  {
    id: "smc-ict-v4",
    name: "SMC/ICT v4",
    description: "Daily bias + Kill zones + Liquidity raid + 15m confirm + SPY filter + Reversal confluences (IFVG, BOS, OTE) + Continuation confluences (FVG, EQ, OB, Breaker)",
    rules_json: JSON.stringify({
      timeframe: "15m",
      bias_timeframe: "1D",
      entry_conditions: ["kill_zone", "liquidity_raid", "bos_confirm", "spy_filter"],
      confluence_reversal: ["ifvg", "bos", "ote"],
      confluence_continuation: ["fvg", "eq", "ob", "breaker"],
      tp_pct: 0.04,
      max_stop_pct: 0.03,
      min_rr: 2.0,
      position_size_pct: 0.35,
      max_risk_pct: 0.03,
    }),
    enabled: 1,
    weight: 1.0,
    config_json: JSON.stringify({
      universe: ["RIOT", "MARA", "HUT", "RCAT", "IONQ", "TSLA", "UVXY", "HOOD", "SNAP", "ALAB", "AAOI", "CRDO"],
      broker: "alpaca",
      paper: true,
    }),
    capital_tier: 2,
  },
]

for (const s of strategies) {
  await db.execute({
    sql: `INSERT OR REPLACE INTO strategies (id, name, description, rules_json, enabled, weight, config_json, capital_tier, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [s.id, s.name, s.description, s.rules_json, s.enabled, s.weight, s.config_json, s.capital_tier, Date.now()],
  })
  console.log(`Seeded: ${s.name}`)
}

// Seed the 6 council agents
const agents = [
  {
    id: "observer-ml",
    name: "Observer",
    role: "observer",
    system_prompt: "Pure ML pattern miner. No LLM. Reads trades, features, outcomes. Writes to patterns table.",
    model_provider: null,
    model_id: null,
    model_family: null,
    status: "active",
  },
  {
    id: "researcher-groq",
    name: "Researcher",
    role: "researcher",
    system_prompt: `You are a quantitative trading researcher. You read ML-discovered patterns and draft testable strategy improvement proposals.

Your proposals must:
1. Have a clear hypothesis grounded in market microstructure
2. Reference specific pattern data (lift, sample size, p-value)
3. Include a precise proposed change (parameter, filter, or rule)
4. Include a test plan

Output must be valid JSON matching the ProposalSchema. Invalid JSON will be rejected.`,
    model_provider: "groq",
    model_id: "llama-3.3-70b-versatile",
    model_family: "llama",
    status: "active",
  },
  {
    id: "critic-a-groq",
    name: "Critic A",
    role: "critic",
    system_prompt: `You are a skeptical quantitative analyst reviewing trading strategy proposals. Score each proposal 0-1 on: novelty (0-1), evidence_quality (0-1), overfit_risk (0-1, lower = worse), alignment (0-1). Output valid JSON only.`,
    model_provider: "groq",
    model_id: "llama-3.1-8b-instant",
    model_family: "llama",
    status: "active",
  },
  {
    id: "critic-b-cerebras",
    name: "Critic B",
    role: "critic",
    system_prompt: `You are a systematic trading critic from a different analytical tradition. Independently score proposals 0-1. Be especially skeptical of survivorship bias and data mining. Output valid JSON only.`,
    model_provider: "cerebras",
    model_id: "qwen-3-32b",
    model_family: "qwen",
    status: "active",
  },
  {
    id: "risk-manager-groq",
    name: "Risk Manager",
    role: "risk",
    system_prompt: `You are a risk manager enforcing hard limits and soft judgment on strategy proposals. Hard limits: 2% max daily loss, 5% max position. Evaluate: correlation with active strategies, regime concentration, tail risk. Output: {verdict: "approve"|"veto", reason: string, risk_factors: string[]}`,
    model_provider: "groq",
    model_id: "llama-3.3-70b-versatile",
    model_family: "llama",
    status: "active",
  },
  {
    id: "meta-agent-groq",
    name: "Meta-Agent",
    role: "meta",
    system_prompt: `You are the meta-optimizer for a council of trading agents. Monthly, you read all agent scores and propose improvements. You can: update prompts (max 1/agent/month), adjust critic weights, propose spawning new specialists, recommend retiring underperformers. Every change requires user approval. Output valid JSON.`,
    model_provider: "groq",
    model_id: "llama-3.3-70b-versatile",
    model_family: "llama",
    status: "active",
  },
]

for (const a of agents) {
  await db.execute({
    sql: `INSERT OR REPLACE INTO agents (id, name, role, system_prompt, model_provider, model_id, model_family, status, spawned_at, spawned_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user')`,
    args: [a.id, a.name, a.role, a.system_prompt, a.model_provider, a.model_id, a.model_family, a.status, Date.now()],
  })
  console.log(`Seeded agent: ${a.name}`)
}

// Set holdout boundary to 80% of current time range
await db.execute({
  sql: "INSERT OR REPLACE INTO holdout_config (id, boundary_timestamp, updated_at) VALUES (1, ?, ?)",
  args: [Date.now() - 90 * 86400000, Date.now()], // 90 days ago = boundary (20% holdout = last ~22 days)
})
console.log("Holdout boundary set")

db.close()
console.log("\nSeed complete.")
