// GET /api/source-performance — per-source execution stats + cross-source agreement.

import { getSourcePerformance, getInstrumentAgreement } from "@/lib/learning/source-correlation"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const daysBack = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30)))
  const agreementDays = Math.min(30, Math.max(1, Number(url.searchParams.get("agreement_days") ?? 7)))

  const [performance, agreement] = await Promise.all([
    getSourcePerformance(daysBack),
    getInstrumentAgreement(agreementDays),
  ])

  return Response.json({
    days_back: daysBack,
    agreement_days: agreementDays,
    performance,
    agreement,
  })
}
