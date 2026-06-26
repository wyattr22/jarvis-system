import { safeFetch } from "@/lib/sandbox/whitelist"

const ALPACA_BASE =
  process.env.ALPACA_PAPER === "true"
    ? "https://paper-api.alpaca.markets"
    : "https://api.alpaca.markets"

const alpacaHeaders = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  'Content-Type': 'application/json',
})

export async function POST(req: Request) {
  const { side, qty, symbol } = await req.json()
  if (!symbol) {
    return Response.json({ error: "symbol required" }, { status: 400 })
  }

  const sym = symbol.toUpperCase()

  // Close all positions
  if (sym === 'ALL') {
    const res = await safeFetch(`${ALPACA_BASE}/v2/positions?cancel_orders=true`, {
      method: 'DELETE',
      headers: alpacaHeaders(),
    })
    if (!res.ok) {
      const err = await res.text()
      return Response.json({ error: err }, { status: res.status })
    }
    return Response.json({ ok: true, action: 'close_all' })
  }

  // Close full position in a single symbol (qty === 0)
  if (!qty || qty === 0) {
    const res = await safeFetch(`${ALPACA_BASE}/v2/positions/${sym}`, {
      method: 'DELETE',
      headers: alpacaHeaders(),
    })
    if (!res.ok) {
      const err = await res.text()
      return Response.json({ error: err }, { status: res.status })
    }
    const order = await res.json()
    return Response.json({ ok: true, orderId: order.id, action: 'close_position' })
  }

  // Standard market order
  if (!side) {
    return Response.json({ error: "side required for market orders" }, { status: 400 })
  }

  const res = await safeFetch(`${ALPACA_BASE}/v2/orders`, {
    method: 'POST',
    headers: alpacaHeaders(),
    body: JSON.stringify({
      symbol: sym,
      qty: String(qty),
      side,
      type: 'market',
      time_in_force: 'day',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return Response.json({ error: err }, { status: res.status })
  }

  const order = await res.json()
  return Response.json({ ok: true, orderId: order.id })
}
