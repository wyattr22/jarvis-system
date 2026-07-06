// Daily cron: flips opportunities past their expires_at from 'open' to 'expired'.
// Auth: CRON_SECRET. Vercel cron in vercel.json calls this at 6am UTC.

import { expireOpportunities } from "@/lib/opportunities/store"

export const maxDuration = 30

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const result = await expireOpportunities()
  return Response.json({ ok: true, ...result, ts: Date.now() })
}
