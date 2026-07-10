// Daily digest trigger (13.3). Post-close cron; public GET = recent digests.

import { runDailyDigest, getDigests } from "@/lib/agents/digest"

export const maxDuration = 120

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return Response.json(await runDailyDigest())
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`) {
    try {
      return Response.json(await runDailyDigest())
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }
  try {
    return Response.json({ digests: await getDigests() })
  } catch {
    return Response.json({ digests: [] })
  }
}
