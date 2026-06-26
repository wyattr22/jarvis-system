import { getBars } from "@/lib/data/alpaca"
import { analyzeSMC } from "@/lib/market/smc"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const { searchParams } = new URL(req.url)
  const timeframe = searchParams.get("timeframe") ?? "15Min"
  const limit = Math.min(Number(searchParams.get("limit") ?? "200"), 1000)

  try {
    const bars = await getBars(symbol.toUpperCase(), timeframe, limit)
    const smc = bars.length >= 15 ? analyzeSMC(bars, symbol.toUpperCase()) : null
    return Response.json({ symbol, timeframe, bars, smc })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 })
  }
}
