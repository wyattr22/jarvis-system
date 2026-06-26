"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"

type State = "idle" | "listening" | "thinking" | "speaking"

type TradeOrder = { side: 'buy' | 'sell'; qty: number; symbol: string }

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition
    webkitSpeechRecognition: new () => SpeechRecognition
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult
  length: number
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}

interface SpeechRecognitionAlternative {
  transcript: string
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

const WINDOW = 4

type HistoryTurn = { role: "user" | "assistant"; content: string }

export function VoiceAgent() {
  const router = useRouter()
  const [state, setState] = useState<State>("idle")
  const [bubbleWords, setBubbleWords] = useState<string[]>([])
  const [transcript, setTranscript] = useState("")
  const [supported, setSupported] = useState(true)
  const [pendingTrade, setPendingTrade] = useState<TradeOrder | null>(null)
  // Keep pendingTradeRef in sync so rec.onend closure always reads the latest value
  useEffect(() => { pendingTradeRef.current = pendingTrade }, [pendingTrade])

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const transcriptRef = useRef("")
  const fullTextRef = useRef("")
  const historyRef = useRef<HistoryTurn[]>([])
  const britishVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const wordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingTradeRef = useRef<TradeOrder | null>(null)

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) { setSupported(false); return }
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = "en-GB"
    recognitionRef.current = rec

    // Load British male voice into ref — voices may not be ready immediately
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices()
      if (!voices.length) return
      britishVoiceRef.current =
        voices.find(v => v.name === "Daniel") ??
        voices.find(v => v.name === "Malcolm") ??
        voices.find(v => v.name === "Oliver") ??
        voices.find(v => v.lang === "en-GB" && !v.name.toLowerCase().includes("female")) ??
        voices.find(v => v.lang === "en-GB") ??
        null
    }
    pickVoice()
    window.speechSynthesis.onvoiceschanged = pickVoice

    // Register service worker + subscribe to push notifications
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js').then(async (reg) => {
        const perm = await Notification.requestPermission().catch(() => 'denied')
        if (perm !== 'granted') return
        const existing = await reg.pushManager.getSubscription()
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        })
        if (sub) {
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub),
          }).catch(() => {})
        }
      }).catch(() => {})
    }
  }, [])

  const startWordBubble = useCallback((text: string) => {
    if (wordTimerRef.current) clearInterval(wordTimerRef.current)
    const words = text.split(/\s+/).filter(Boolean)
    let wordIndex = 0
    // ~145 WPM — matches natural speech pace
    const msPerWord = Math.max(240, Math.min(420, 60000 / 145))
    wordTimerRef.current = setInterval(() => {
      if (wordIndex >= words.length) {
        clearInterval(wordTimerRef.current!)
        return
      }
      const start = Math.max(0, wordIndex - WINDOW + 1)
      setBubbleWords(words.slice(start, wordIndex + 1))
      wordIndex++
    }, msPerWord)
  }, [])

  const stopWordBubble = useCallback(() => {
    if (wordTimerRef.current) { clearInterval(wordTimerRef.current); wordTimerRef.current = null }
    setBubbleWords([])
  }, [])

  const speakBrowser = useCallback((text: string) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const words = text.split(/\s+/).filter(Boolean)
    let wordIndex = 0
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = 1.0
    utt.pitch = 0.85
    utt.volume = 1
    if (britishVoiceRef.current) utt.voice = britishVoiceRef.current
    utt.onboundary = (event: SpeechSynthesisEvent) => {
      if (event.name === "word" && wordIndex < words.length) {
        const start = Math.max(0, wordIndex - WINDOW + 1)
        setBubbleWords(words.slice(start, wordIndex + 1))
        wordIndex++
      }
    }
    utt.onend = () => { setState("idle"); setBubbleWords([]) }
    utt.onerror = () => { setState("idle"); setBubbleWords([]) }
    window.speechSynthesis.speak(utt)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const speak = useCallback(async (text: string) => {
    window.speechSynthesis?.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    stopWordBubble()
    setState("speaking")
    fullTextRef.current = text

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })

      if (!res.ok) throw new Error(`TTS ${res.status}`)

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      startWordBubble(text)

      audio.onended = () => {
        setState("idle")
        stopWordBubble()
        URL.revokeObjectURL(url)
        audioRef.current = null
      }
      audio.onerror = () => {
        setState("idle")
        stopWordBubble()
        URL.revokeObjectURL(url)
        audioRef.current = null
      }

      await audio.play()
    } catch {
      // ElevenLabs unavailable — fall back to browser TTS
      speakBrowser(text)
    }
  }, [startWordBubble, stopWordBubble, speakBrowser]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    stopWordBubble()
    setState("idle")
  }, [stopWordBubble])

  const handleMic = useCallback(() => {
    if (state === "speaking") { stopSpeaking(); return }
    if (state === "thinking" || state === "listening") {
      try { recognitionRef.current?.stop() } catch { /* ignore */ }
      setState("idle")
      return
    }

    const rec = recognitionRef.current
    if (!rec) return
    setTranscript("")
    transcriptRef.current = ""
    setBubbleWords([])
    setState("listening")

    rec.onresult = (e) => {
      const text = e.results[0][0].transcript
      setTranscript(text)
      transcriptRef.current = text
    }
    rec.onerror = (e) => {
      if ((e as SpeechRecognitionErrorEvent).error !== "no-speech") setState("idle")
      setState("idle")
    }
    rec.onend = async () => {
      const query = transcriptRef.current.trim()
      if (!query) { setState("idle"); return }
      setTranscript(query)

      // Intercept verbal confirmation/cancellation of a pending trade
      if (pendingTradeRef.current) {
        const lower = query.toLowerCase()
        const trade = pendingTradeRef.current
        if (/\bconfirm\b/.test(lower)) {
          setPendingTrade(null)
          setState("thinking")
          try {
            await fetch('/api/trade', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(trade),
            })
            const action = trade.qty === 0
              ? (trade.symbol === 'ALL' ? 'closing all positions' : `closing ${trade.symbol}`)
              : `${trade.side}ing ${trade.qty} shares of ${trade.symbol}`
            speak(`Order confirmed — ${action}.`)
          } catch {
            speak('Something went wrong placing the order.')
          }
          return
        } else if (/\bcancel\b/.test(lower)) {
          setPendingTrade(null)
          speak('Order cancelled.')
          return
        }
        // Unrecognised — clear pending and fall through to normal processing
        setPendingTrade(null)
      }

      setState("thinking")
      try {
        const chartSymbol = localStorage.getItem('jarvis_chart_symbol') ?? undefined
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, history: historyRef.current, chartSymbol }),
        })
        const data = await res.json()
        const reply = data.response ?? "No response."
        const action = data.action

        // Append to conversation history (keep last 10 turns)
        historyRef.current = [
          ...historyRef.current,
          { role: "user" as const, content: query },
          { role: "assistant" as const, content: reply },
        ].slice(-20)
        if (data.tradeOrder) {
          setPendingTrade(data.tradeOrder)
        }

        // Execute Jarvis site control action
        if (action) {
          if (action.type === 'navigate') {
            router.push(action.path)
          } else if (action.type === 'loadChart') {
            localStorage.setItem('jarvis_chart_symbol', action.symbol)
            if (action.timeframe) localStorage.setItem('jarvis_chart_timeframe', action.timeframe)
            // Always fire immediately — if listener is live (already on charts) it updates the chart.
            // If not registered yet (navigating fresh) the event is a no-op and localStorage handles it on mount.
            window.dispatchEvent(new CustomEvent('jarvis:loadChart', {
              detail: { symbol: action.symbol, timeframe: action.timeframe }
            }))
            router.push('/charts')
          } else if (action.type === 'searchNews') {
            localStorage.setItem('jarvis_news_search', action.query)
            window.dispatchEvent(new CustomEvent('jarvis:searchNews', { detail: { query: action.query } }))
            router.push('/news')
          } else if (action.type === 'drawZone') {
            window.dispatchEvent(new CustomEvent('jarvis:drawZone', {
              detail: { symbol: action.symbol, zoneType: action.zoneType, levels: action.levels, priceRange: action.priceRange }
            }))
          } else if (action.type === 'setAlert') {
            window.dispatchEvent(new CustomEvent('jarvis:setAlert', {
              detail: { symbol: action.symbol, price: action.price, condition: action.condition }
            }))
          } else if (action.type === 'backtest') {
            router.push('/backtest')
          }
        }

        speak(reply)
      } catch {
        setState("idle")
      }
    }
    rec.start()
  }, [state, speak, stopSpeaking])

  if (!supported) return null

  const showBubble = state === "speaking" && bubbleWords.length > 0
  const showTranscript = state === "thinking" && transcript
  const showListening = state === "listening"
  const showDots = state === "thinking" && !transcript

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 select-none">

      {/* Word bubble — appears while speaking */}
      {showBubble && (
        <div className="bg-background/95 backdrop-blur border border-primary/30 rounded-full px-4 py-2 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-150">
          <p className="text-xs text-foreground tracking-wide whitespace-nowrap">
            {bubbleWords.map((w, i) => (
              <span
                key={i}
                className={i === bubbleWords.length - 1 ? "text-primary font-medium" : "text-muted-foreground"}
              >
                {w}{i < bubbleWords.length - 1 ? " " : ""}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* Transcript pill — shown while thinking */}
      {showTranscript && (
        <div className="bg-background/95 backdrop-blur border border-border rounded-full px-3 py-1.5 shadow max-w-[200px]">
          <p className="text-[10px] text-muted-foreground italic truncate">"{transcript}"</p>
        </div>
      )}

      {/* Trade confirmation pill */}
      {pendingTrade && (
        <div className="bg-background/95 backdrop-blur border border-yellow-400/50 rounded-lg px-4 py-3 shadow-lg max-w-[220px]">
          <p className="text-[10px] text-yellow-400 tracking-widest mb-2">TRADE CONFIRMATION</p>
          <p className="text-xs text-foreground mb-3">
            {pendingTrade.side.toUpperCase()} {pendingTrade.qty} {pendingTrade.symbol}
          </p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await fetch('/api/trade', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(pendingTrade),
                })
                setPendingTrade(null)
                speak(`Order placed — ${pendingTrade.side}ing ${pendingTrade.qty} shares of ${pendingTrade.symbol}.`)
              }}
              className="flex-1 text-[10px] tracking-widest border border-primary text-primary rounded px-2 py-1 hover:bg-primary/10 transition-colors"
            >
              CONFIRM
            </button>
            <button
              onClick={() => { setPendingTrade(null); speak('Order cancelled.') }}
              className="flex-1 text-[10px] tracking-widest border border-border text-muted-foreground rounded px-2 py-1 hover:text-foreground transition-colors"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Thinking dots */}
      {showDots && (
        <div className="bg-background/95 backdrop-blur border border-yellow-400/30 rounded-full px-4 py-2 shadow">
          <span className="text-yellow-400 text-xs tracking-[0.3em] animate-pulse">···</span>
        </div>
      )}

      {/* Listening indicator */}
      {showListening && (
        <div className="bg-background/95 backdrop-blur border border-red-400/30 rounded-full px-3 py-1.5 shadow">
          <span className="text-[10px] text-red-400 tracking-widest animate-pulse">LISTENING</span>
        </div>
      )}

      {/* Mic button */}
      <button
        onClick={handleMic}
        title={state === "speaking" ? "Stop" : state === "listening" ? "Cancel" : "Ask Jarvis"}
        className={[
          "w-11 h-11 rounded-full border flex items-center justify-center transition-all shadow-lg",
          state === "listening" ? "border-red-400/70 bg-red-400/10" :
          state === "thinking"  ? "border-yellow-400/70 bg-yellow-400/10" :
          state === "speaking"  ? "border-primary/70 bg-primary/10" :
          "border-border bg-background hover:border-primary/50 hover:bg-primary/5",
        ].join(" ")}
      >
        {state === "speaking" ? (
          // Stop icon
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        ) : state === "thinking" ? (
          <span className="text-yellow-400 text-[10px] tracking-[0.2em] font-mono animate-pulse">···</span>
        ) : (
          // Mic icon
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={state === "listening" ? "text-red-400" : "text-muted-foreground"}>
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>
    </div>
  )
}
