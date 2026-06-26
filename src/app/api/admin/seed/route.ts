import { db } from "@/lib/db/client"

export async function POST(req: Request) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 86400000
  const created: string[] = []

  // Seed the SMC/ICT v4 strategy row
  const existing = await db.execute({ sql: "SELECT id FROM strategies WHERE id = ?", args: ["smc-ict-v4"] })
  if (existing.rows.length === 0) {
    await db.execute({
      sql: `INSERT INTO strategies (id, name, description, enabled, capital_tier, weight, created_at)
            VALUES (?, ?, ?, 1, 1, 1.0, ?)`,
      args: [
        "smc-ict-v4",
        "SMC/ICT v4",
        "Smart Money Concepts / ICT methodology (bot.py v22). 4 kill zones: NY open (9:30-10:15), NY lunch (12:00-12:30), London close (13:00-13:30), NY PM (14:30-15:00). Requires 2/3 reversal confluences (IFVG+BOS+OTE 0.62-0.79) + 1/4 continuation (FVG/EQ/OB/BREAKER). SPY trend filter, RSI 40-80, R:R>=2, TP=DOL or 4%, SL=structure max 3%. 12 symbols: RIOT MARA HUT RCAT IONQ TSLA UVXY HOOD SNAP ALAB AAOI CRDO.",
        now,
      ],
    })
    created.push("strategy: smc-ict-v4")
  }

  // Seed holdout config (boundary = 30 days ago so Observer has initial data)
  const hc = await db.execute({ sql: "SELECT id FROM holdout_config WHERE id = 1", args: [] })
  if (hc.rows.length === 0) {
    await db.execute({
      sql: "INSERT INTO holdout_config (id, boundary_timestamp, updated_at) VALUES (1, ?, ?)",
      args: [thirtyDaysAgo, now],
    })
    created.push("holdout_config: boundary=30d ago")
  }

  // Seed default agent rows if missing
  const agentSeeds = [
    { id: "observer-ml", name: "Observer", role: "observer", model_provider: "internal", model_id: "random-forest", model_family: "ml" },
    { id: "researcher-groq", name: "Researcher", role: "researcher", model_provider: "groq", model_id: "llama-3.3-70b-versatile", model_family: "llama" },
    { id: "critic-a-groq", name: "Critic A", role: "critic", model_provider: "groq", model_id: "llama-3.1-8b-instant", model_family: "llama" },
    { id: "critic-b-cerebras", name: "Critic B", role: "critic", model_provider: "cerebras", model_id: "llama3.1-8b", model_family: "cerebras" },
    { id: "critic-c-openrouter", name: "Critic C", role: "critic", model_provider: "openrouter", model_id: "deepseek/deepseek-r1:free", model_family: "deepseek" },
    { id: "risk-manager-groq", name: "Risk Manager", role: "risk_manager", model_provider: "groq", model_id: "llama-3.3-70b-versatile", model_family: "llama" },
    { id: "meta-agent-groq", name: "Meta-Agent", role: "meta_agent", model_provider: "groq", model_id: "llama-3.3-70b-versatile", model_family: "llama" },
  ]

  for (const a of agentSeeds) {
    const ex = await db.execute({ sql: "SELECT id FROM agents WHERE id = ?", args: [a.id] })
    if (ex.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO agents (id, name, role, model_provider, model_id, model_family, status, spawned_at, spawned_by)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 'seed')`,
        args: [a.id, a.name, a.role, a.model_provider, a.model_id, a.model_family, now],
      })
      created.push(`agent: ${a.id}`)
    }
  }

  return Response.json({ ok: true, created, message: created.length ? `Seeded: ${created.join(", ")}` : "Already seeded — nothing to do" })
}
