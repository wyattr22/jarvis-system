import { getEarningsCalendar } from "@/lib/data/earnings"

export async function GET() {
  const earnings = await getEarningsCalendar()
  const hasKey = !!process.env.ALPHA_VANTAGE_KEY
  return Response.json({ earnings, hasKey })
}
