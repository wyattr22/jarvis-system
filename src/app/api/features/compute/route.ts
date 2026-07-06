import { getBars } from "@/lib/data/alpaca"
import { computeFeatures } from "@/lib/features/engineer"
import { storeFeatures } from "@/lib/features/store"
import { getActiveUniverse } from "@/lib/universe/store"

// Feature snapshots cover the top of the rotating scan universe (12.3) —
// previously a hardcoded 11-symbol list.
const FEATURE_UNIVERSE_SIZE = 50

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const INSTRUMENTS = await getActiveUniverse(FEATURE_UNIVERSE_SIZE)
  const results: { instrument: string; status: string; features?: number }[] = []

  for (let i = 0; i < INSTRUMENTS.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 400))
    const instrument = INSTRUMENTS[i]
    try {
      const bars = await getBars(instrument, "15Min", 500)
      if (bars.length < 30) {
        results.push({ instrument, status: "insufficient_bars" })
        continue
      }

      const fs = computeFeatures(instrument, bars)
      if (!fs) {
        results.push({ instrument, status: "compute_failed" })
        continue
      }

      await storeFeatures(fs)
      results.push({ instrument, status: "ok", features: Object.keys(fs.features).length })
    } catch (e) {
      results.push({ instrument, status: `error: ${String(e)}` })
    }
  }

  return Response.json({ computed: results.filter(r => r.status === "ok").length, results })
}
