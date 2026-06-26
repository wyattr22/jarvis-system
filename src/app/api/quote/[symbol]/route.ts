import { getLatestQuote } from "@/lib/data/alpaca"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  try {
    const quote = await getLatestQuote(symbol.toUpperCase())
    return Response.json(quote)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 })
  }
}
