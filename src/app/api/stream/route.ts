import { getMultipleQuotes } from "@/lib/data/alpaca"

const SYMBOLS = ["TSLA", "RIOT", "MARA", "HUT", "IONQ", "HOOD", "SNAP", "NVDA", "AAPL", "SPY", "QQQ", "ALAB"]
const POLL_MS = 3000

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const poll = async () => {
        try {
          const quotes = await getMultipleQuotes(SYMBOLS)
          send({ type: "quotes", data: quotes, ts: Date.now() })
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
