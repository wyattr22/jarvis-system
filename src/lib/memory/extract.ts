import Groq from "groq-sdk"
import { saveMemory, getAllMemories } from "./store"

// Lazy init: the SDK throws at construction when the key is absent, which
// crashed `next build` page-data collection in keyless environments (11.12).
let _groq: Groq | null = null
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  return _groq
}

interface ExtractedMemory {
  type: "fact" | "insight" | "pattern" | "preference"
  content: string
  tags: string[]
  importance: number
  source: "user_said" | "jarvis_observed"
}

export async function extractAndSaveMemories(
  userQuery: string,
  jarvisResponse: string,
  tickers: string[]
): Promise<void> {
  try {
    const prompt = `You are a memory extraction system for an AI trading assistant named Jarvis.

Review this conversation turn and extract anything Jarvis should remember. Bias toward capturing more rather than less — recall is cheap, missed context is expensive.

USER: "${userQuery}"
JARVIS: "${jarvisResponse}"

EXTRACT (be generous):
- Any stated user preference, opinion, or workflow choice
- Any fact about the user's account, strategies, watchlist, schedule, broker, capital
- Any observation about market state the user reacted to (even if obvious)
- Any setup, rule, or trading idea discussed
- Any name, ticker, level, or number the user emphasised
- Any correction or clarification the user made

ONLY SKIP:
- Pure greetings ("hi", "thanks")
- Single-word answers with no content ("yes", "ok")
- Mechanical commands ("pull up chart", "go to news")

When in doubt, save it with low importance (3–5). Better to over-capture than to forget. If genuinely empty, return an empty array.

Return JSON only, no explanation:
{
  "memories": [
    {
      "type": "fact" | "insight" | "pattern" | "preference",
      "content": "concise markdown statement, 1-2 sentences max",
      "tags": ["TSLA", "entries", ...],
      "importance": 1-10,
      "source": "user_said" | "jarvis_observed"
    }
  ]
}`

    const res = await getGroq().chat.completions.create({
      model: "llama-3.1-8b-instant",  // fast cheap model for extraction
      max_tokens: 400,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    })

    const raw = res.choices[0]?.message?.content ?? "{}"
    const parsed = JSON.parse(raw) as { memories?: ExtractedMemory[] }
    const memories = parsed.memories ?? []

    for (const mem of memories) {
      // Lowered from importance >= 4 to >= 2 so Jarvis captures more context.
      // Importance 1 is reserved for "skip" by the extractor itself.
      if (mem.content && mem.type && mem.importance >= 2) {
        await saveMemory(mem.content, mem.type, {
          tags: [...new Set([...mem.tags, ...tickers])],
          importance: mem.importance,
          source: mem.source,
        })
      }
    }
  } catch {
    // Memory extraction failing should never break the voice response
  }
}

export async function formatMemoriesForContext(memories: { type: string; content: string; importance: number; source: string }[]): Promise<string> {
  if (!memories.length) return ""
  const grouped: Record<string, string[]> = {}
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = []
    grouped[m.type].push(`  - ${m.content}${m.importance >= 8 ? ' [IMPORTANT]' : ''}`)
  }
  const lines = ["JARVIS MEMORY (from past conversations):"]
  for (const [type, items] of Object.entries(grouped)) {
    lines.push(`${type.toUpperCase()}S:`)
    lines.push(...items)
  }
  return lines.join('\n')
}
