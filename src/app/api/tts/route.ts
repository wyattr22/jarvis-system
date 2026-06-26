import { safeFetch } from "@/lib/sandbox/whitelist"

// TTS route — tier order:
//   1. ElevenLabs  (best quality — set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID to enable)
//   2. StreamElements Brian  (Amazon Polly en-GB male)
//   3. StreamElements Arthur (Amazon Polly en-GB male neural — separate bucket)
//   4. StreamElements Amy    (Amazon Polly en-GB female — last resort, at least British)
//   5. 503 → client falls back to browser speech synthesis

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "onwK4e9ZLuTAKqWW03F9"

async function tryFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    const res = await safeFetch(url, { signal: AbortSignal.timeout(8000), ...init })
    if (res.ok) {
      // Verify it's actually audio — a text/html "error" page still returns 200 on some CDNs
      const ct = res.headers.get("content-type") ?? ""
      if (!ct.includes("audio") && !ct.includes("mpeg") && !ct.includes("octet")) return null
      return res
    }
    return null
  } catch { return null }
}

export async function POST(req: Request) {
  const { text } = await req.json()
  if (!text || typeof text !== "string") {
    return new Response("text required", { status: 400 })
  }

  // Increase limit to 600 chars — 400 was cutting off 3-4 sentence answers mid-word
  const clean = text.slice(0, 600)
  const encoded = encodeURIComponent(clean)
  const audioHeaders = { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }

  // ── Tier 1: ElevenLabs (optional premium upgrade) ────────────
  const elKey = process.env.ELEVENLABS_API_KEY
  if (elKey) {
    const res = await tryFetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
      {
        method: "POST",
        headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clean,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true },
        }),
        signal: AbortSignal.timeout(15000),
      }
    )
    if (res) { console.log("[tts] ElevenLabs"); return new Response(res.body, { headers: audioHeaders }) }
  }

  // ── Tier 2: StreamElements Brian — Amazon Polly en-GB male ───
  const r2 = await tryFetch(
    `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encoded}`
  )
  if (r2) { console.log("[tts] Brian"); return new Response(r2.body, { headers: audioHeaders }) }

  // ── Tier 3: StreamElements Arthur — Amazon Polly en-GB male neural
  const r3 = await tryFetch(
    `https://api.streamelements.com/kappa/v2/speech?voice=Arthur&text=${encoded}`
  )
  if (r3) { console.log("[tts] Arthur"); return new Response(r3.body, { headers: audioHeaders }) }

  // ── Tier 4: StreamElements Amy — en-GB female, at least British ─
  const r4 = await tryFetch(
    `https://api.streamelements.com/kappa/v2/speech?voice=Amy&text=${encoded}`
  )
  if (r4) { console.log("[tts] Amy"); return new Response(r4.body, { headers: audioHeaders }) }

  // ── Tier 5: nothing worked — client uses browser TTS ─────────
  console.log("[tts] 503 — all providers failed")
  return new Response("TTS unavailable", { status: 503 })
}
