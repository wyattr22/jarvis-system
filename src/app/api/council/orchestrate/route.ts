import { runFullCouncilCycle } from "@/lib/agents/orchestrator"
import { sendPushToAll } from "@/lib/push"

function checkAuth(req: Request): boolean {
  const authHeader = req.headers.get("authorization")
  const cronHeader = req.headers.get("x-vercel-cron")
  // Accept Vercel cron header OR Bearer secret
  return cronHeader === "1" || authHeader === `Bearer ${process.env.CRON_SECRET}`
}

// Vercel crons send GET; manual triggers can use POST
export async function GET(req: Request) {
  if (!checkAuth(req)) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const strategyId = new URL(req.url).searchParams.get("strategyId") ?? "smc-ict-v4"
  const result = await runFullCouncilCycle(strategyId)

  if (result?.proposalId) {
    await sendPushToAll({
      title: "Jarvis Council Complete",
      body: `New proposal submitted for review. Status: ${result.overallStatus ?? "pending"}.`,
      tag: "council",
      url: "/proposals",
    })
  }

  return Response.json(result ?? { message: "No patterns to process" })
}

// POST is called from the dashboard UI — no auth required (internal app only)
export async function POST(req: Request) {
  const { strategyId } = await req.json().catch(() => ({ strategyId: "smc-ict-v4" }))
  const result = await runFullCouncilCycle(strategyId)

  if (result?.proposalId) {
    await sendPushToAll({
      title: "Jarvis Council Complete",
      body: `New proposal submitted for review. Status: ${result.overallStatus ?? "pending"}.`,
      tag: "council",
      url: "/proposals",
    })
  }

  return Response.json(result ?? { message: "No patterns to process" })
}
