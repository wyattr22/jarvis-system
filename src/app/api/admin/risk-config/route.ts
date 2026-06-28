// Admin endpoint for risk configuration.
//
//   GET  /api/admin/risk-config   → current config (CRON_SECRET-protected for write parity; reads OK without)
//   POST /api/admin/risk-config   → seed defaults or patch
//
// Reads are open (the /allocator UI uses them).
// Writes require CRON_SECRET.

import { getRiskConfig, updateRiskConfig, seedDefaults } from "@/lib/allocator/risk-config"

function authed(req: Request): boolean {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET() {
  const config = await getRiskConfig()
  return Response.json({ config })
}

export async function POST(req: Request) {
  if (!authed(req)) return new Response("Unauthorized", { status: 401 })
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch { /* empty body OK */ }

  if (body.action === "seed") {
    await seedDefaults()
    return Response.json({ ok: true, action: "seed", config: await getRiskConfig() })
  }

  // Otherwise treat the body as a patch.
  const next = await updateRiskConfig(body as never)
  return Response.json({ ok: true, action: "patch", config: next })
}
