import { ingestResearch, listResearchSources } from "@/lib/research/store"

function authOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true  // dev: no secret set
  const h = req.headers.get("authorization") ?? ""
  return h === `Bearer ${secret}`
}

// POST /api/research/ingest
// Body: { sourceName: string, content: string, brief?: string }
// Auth: Bearer CRON_SECRET
export async function POST(req: Request) {
  if (!authOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { sourceName, content, brief } = await req.json()
  if (!sourceName || typeof sourceName !== "string") return Response.json({ error: "sourceName required" }, { status: 400 })
  if (!content   || typeof content    !== "string") return Response.json({ error: "content required" },    { status: 400 })

  try {
    const result = await ingestResearch(sourceName, content, brief)
    return Response.json({ ok: true, sourceName, chunks: result.chunks })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// GET /api/research/ingest — list all ingested sources
export async function GET(req: Request) {
  if (!authOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 })
  const sources = await listResearchSources()
  return Response.json({ sources })
}
