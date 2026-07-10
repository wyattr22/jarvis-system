// Research agent trigger (13.2). Daily pre-market cron; public GET returns
// recent notes for dashboards.

import { runResearchAgent, getLatestResearchNotes } from "@/lib/agents/market-research"

export const maxDuration = 120

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return Response.json(await runResearchAgent())
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`) {
    try {
      return Response.json(await runResearchAgent())
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }
  try {
    return Response.json({ notes: await getLatestResearchNotes() })
  } catch {
    return Response.json({ notes: [] })
  }
}
