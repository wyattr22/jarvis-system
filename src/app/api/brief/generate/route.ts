import { db } from "@/lib/db/client"
import Groq from "groq-sdk"
import { getAccount, getPositions, getVIX, getBTCPrice, getSectorETFs } from "@/lib/data/alpaca"
import { getIntermarketSnapshot, formatIntermarketForContext } from "@/lib/data/intermarket"
import { getTodaysEconomicEvents, formatEconomicsForContext } from "@/lib/data/economics"
import { getJournalInsights, formatJournalForContext } from "@/lib/trading/journal"
import { sendPushToAll } from "@/lib/push"

// Lazy init: the SDK throws at construction when the key is absent, which
// crashed `next build` page-data collection in keyless environments (11.12).
let _groq: Groq | null = null
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  return _groq
}

async function ensureBriefsTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS morning_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret")
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  await ensureBriefsTable()

  const today = new Date().toISOString().slice(0, 10)

  // Gather all context in parallel
  const [account, positions, vix, btc, sectors, intermarket, economics, journal] = await Promise.all([
    getAccount().catch(() => null),
    getPositions().catch(() => []),
    getVIX().catch(() => null),
    getBTCPrice().catch(() => null),
    getSectorETFs().catch(() => ({})),
    getIntermarketSnapshot().catch(() => ({ dxy: null, yield10y: null, gold: null, oil: null, silver: null })),
    getTodaysEconomicEvents().catch(() => []),
    getJournalInsights().catch(() => null),
  ])

  const contextParts: string[] = []
  if (vix !== null) contextParts.push(`VIX: ${vix.toFixed(1)}`)
  if (btc) contextParts.push(`BTC: $${btc.price.toFixed(0)} (${btc.change24h > 0 ? '+' : ''}${btc.change24h.toFixed(2)}% 24h)`)
  const sectorStr = Object.entries(sectors as Record<string, number>).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v.toFixed(1)}%`).join(', ')
  if (sectorStr) contextParts.push(`SECTORS: ${sectorStr}`)
  const imStr = formatIntermarketForContext(intermarket)
  if (imStr) contextParts.push(`INTERMARKET: ${imStr}`)
  const ecoStr = formatEconomicsForContext(economics)
  if (ecoStr) contextParts.push(ecoStr)
  if (account) {
    contextParts.push(`ACCOUNT: equity=$${Number(account.equity).toFixed(2)}, day_pnl=$${Number(account.equity - account.last_equity).toFixed(2)}`)
  }
  if (positions.length) {
    const posStr = (positions as { symbol: string; qty: number; unrealized_pl: number }[])
      .map((p) => `${p.symbol} qty=${p.qty} pnl=$${Number(p.unrealized_pl).toFixed(2)}`)
      .join(', ')
    contextParts.push(`OPEN POSITIONS: ${posStr}`)
  }
  if (journal) contextParts.push(formatJournalForContext(journal))

  const prompt = `You are Jarvis, a trading AI assistant giving a daily morning brief. Keep it concise — 4-6 sentences max. Spoken language only, no lists or markdown.

System state:
${contextParts.join('\n')}

Give a sharp morning brief covering: market conditions, any key economic events today, account status, and one tactical edge tip based on the journal data. Be direct and specific.`

  const res = await getGroq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 200,
    temperature: 0.4,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = res.choices[0]?.message?.content ?? 'No brief generated.'

  // Save to DB
  await db.execute({
    sql: "INSERT OR REPLACE INTO morning_briefs (date, content, created_at) VALUES (?, ?, ?)",
    args: [today, content, Date.now()],
  })

  await sendPushToAll({
    title: "Good morning — Jarvis brief ready",
    body: content.slice(0, 120) + (content.length > 120 ? '…' : ''),
    tag: 'morning-brief',
    url: '/',
  })

  return Response.json({ ok: true, date: today, brief: content })
}
