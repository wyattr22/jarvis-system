import { runOutcomeTracker } from "@/lib/learning/proposal-outcomes"

export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? ""
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const result = await runOutcomeTracker()
  return Response.json({ ok: true, ...result })
}
