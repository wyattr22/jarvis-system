// SSE quote stream. Since 11.8 the symbol set comes from the DB watchlist
// (equity instruments only — the stream is Alpaca-backed), re-read every
// 20th poll (~60s), capped, with the legacy default list as fallback when
// the watchlist is empty. Payload rows are MarketQuotes with freshness meta
// plus the legacy `mid` field so old consumers keep working.

import { getMarketQuotes } from "@/lib/data/alpaca"
import { pickStreamSymbols } from "@/lib/watchlist/stream-symbols"
import { db } from "@/lib/db/client"

const POLL_MS = 3000
const REFRESH_EVERY_N_POLLS = 20

async function loadWatchlistSymbols(): Promise<string[]> {
  try {
    const result = await db.execute({
      sql: `SELECT DISTINCT instrument FROM watchlist ORDER BY created_at DESC`,
      args: [],
    })
    return result.rows.map(r => String(r.instrument))
  } catch {
    return []
  }
}

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let symbols = pickStreamSymbols(await loadWatchlistSymbols())
      let pollCount = 0

      const poll = async () => {
        try {
          pollCount++
          if (pollCount % REFRESH_EVERY_N_POLLS === 0) {
            symbols = pickStreamSymbols(await loadWatchlistSymbols())
          }
          const quotes = await getMarketQuotes(symbols)
          // Legacy compat: expose `mid` alongside the MarketQuote shape
          const rows = quotes.map(q => ({ ...q, mid: q.price }))
          send({ type: "quotes", data: rows, ts: Date.now() })
        } catch {
          // swallow — client will reconnect on SSE drop
        }
      }

      await poll()
      const interval = setInterval(poll, POLL_MS)

      // Clean up when client disconnects
      return () => clearInterval(interval)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
