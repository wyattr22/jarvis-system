// Whole-market scan trigger (12.3). Cron-auth (CRON_SECRET) — scheduled
// pre-market daily in vercel.json; also pingable ad-hoc.
// ~55 batched bar calls over the full tape; runs in roughly a minute.

import { runMarketScan } from "@/lib/universe/scanner"
import { auditLog } from "@/lib/guardrails/audit"

export const maxDuration = 300

async function handle(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await runMarketScan()
    await auditLog("scanner", "universe_scan_complete", { ...result }).catch(() => {})
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) { return handle(req) }
export async function GET(req: Request) { return handle(req) }
