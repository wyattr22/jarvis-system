import { getBars } from "@/lib/data/alpaca"
import { computeFeatures } from "@/lib/features/engineer"
import { storeFeatures } from "@/lib/features/store"

const INSTRUMENTS = ["TSLA", "RIOT", "MARA", "HUT", "IONQ", "HOOD", "SNAP", "RCAT", "ALAB", "AAOI", "CRDO"]

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results: { instrument: string; status: string; features?: number }[] = []

  for (let i = 0; i < INSTRUMENTS.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 600))
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
