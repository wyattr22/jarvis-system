"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"

async function extractPDFText(file: File): Promise<string> {
  // Dynamically load PDF.js from CDN
  if (!(window as unknown as Record<string, unknown>)['pdfjsLib']) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs'
      s.type = 'module'
      s.onload = () => resolve()
      s.onerror = reject
      document.head.appendChild(s)
    })
    // Give it a moment to initialise
    await new Promise(r => setTimeout(r, 300))
  }

  const pdfjsLib = (window as unknown as Record<string, unknown>)['pdfjsLib'] as {
    getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str: string }[] }> }>
    }> }
    GlobalWorkerOptions: { workerSrc: string }
  }

  // Use legacy build worker
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs'

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item: { str: string }) => item.str).join(' '))
  }

  return pages.join('\n\n')
}

type Message = { role: "user" | "assistant"; content: string; fileName?: string }
type Turn    = { role: "user" | "assistant"; content: string }

export function TextChat() {
  const router = useRouter()
  const [isOpen, setIsOpen]       = useState(false)
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState("")
  const [loading, setLoading]     = useState(false)
  const [pendingFile, setPendingFile] = useState<{ name: string; content: string } | null>(null)
  const [fileError, setFileError] = useState("")

  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef    = useRef<HTMLDivElement>(null)
  const historyRef   = useRef<Turn[]>([])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError("")
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""

    const isPDF = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf"
    const isText = [".txt", ".md", ".csv", ".json", ".py", ".ts", ".tsx", ".js", ".jsx", ".html", ".xml", ".log", ".yaml", ".toml"]
      .some(ext => file.name.toLowerCase().endsWith(ext)) || file.type.startsWith("text/")

    if (!isPDF && !isText) {
      setFileError("Unsupported file. Use .pdf, .txt, .md, .csv, .json, or paste content directly.")
      return
    }
    if (file.size > 20_000_000) {
      setFileError("File too large (max 20 MB for PDFs, 400 KB for text).")
      return
    }
    if (!isPDF && file.size > 400_000) {
      setFileError("Text file too large (max 400 KB). Trim it or copy the key sections.")
      return
    }

    if (isPDF) {
      setPendingFile({ name: file.name, content: "__loading__" })
      extractPDFText(file)
        .then(text => {
          if (!text.trim()) {
            setFileError("Couldn't extract text from this PDF — it may be image-only/scanned.")
            setPendingFile(null)
            return
          }
          setPendingFile({ name: file.name, content: text })
        })
        .catch(() => {
          setFileError("Failed to read PDF. Try a different file or paste the content directly.")
          setPendingFile(null)
        })
    } else {
      const reader = new FileReader()
      reader.onload = ev => setPendingFile({ name: file.name, content: ev.target?.result as string ?? "" })
      reader.readAsText(file)
    }
  }, [])

  const send = useCallback(async () => {
    const msg = input.trim()
    if (!msg && !pendingFile) return
    if (pendingFile?.content === "__loading__") return

    const displayContent = msg || `[Attached: ${pendingFile?.name}]`
    const apiQuery       = msg || `Read and summarise this file: ${pendingFile?.name}`

    setMessages(prev => [...prev, { role: "user", content: displayContent, fileName: pendingFile?.name }])
    setInput("")
    const fileSnap = pendingFile
    setPendingFile(null)
    setLoading(true)

    historyRef.current = [...historyRef.current, { role: "user" as const, content: displayContent }].slice(-20)

    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query:       apiQuery,
          history:     historyRef.current.slice(-10),
          chartSymbol: typeof localStorage !== "undefined" ? (localStorage.getItem("jarvis_chart_symbol") ?? undefined) : undefined,
          fileContent: fileSnap?.content,
          fileName:    fileSnap?.name,
        }),
      })
      const data = await res.json()
      const reply = data.response ?? "No response."
      historyRef.current = [...historyRef.current, { role: "assistant" as const, content: reply }].slice(-20)
      setMessages(prev => [...prev, { role: "assistant", content: reply }])

      // Handle navigation actions from chat
      if (data.action?.type === "navigate") router.push(data.action.path)
      if (data.action?.type === "loadChart" && data.action.symbol) {
        localStorage.setItem("jarvis_chart_symbol", data.action.symbol)
        // Fire the event first — charts page listens for this to swap the symbol in-place
        window.dispatchEvent(new CustomEvent("jarvis:loadChart", { detail: { symbol: data.action.symbol, timeframe: data.action.timeframe } }))
        // Navigate to charts page if not already there
        if (!window.location.pathname.startsWith("/charts")) router.push("/charts")
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong — try again." }])
    } finally {
      setLoading(false)
    }
  }, [input, pendingFile, router])

  return (
    <div className="fixed bottom-5 left-5 z-50 flex flex-col items-start gap-2 select-none">

      {/* Chat panel — hidden until toggled */}
      {isOpen && (
        <div
          className="bg-background border border-border rounded-lg shadow-2xl flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{ width: 320, height: 500 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] tracking-[0.2em] text-primary font-medium uppercase">Jarvis Chat</span>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xs leading-none">
              ✕
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center mt-10 tracking-wider leading-relaxed">
                Ask anything or attach a file.<br />
                <span className="opacity-60">Supports .txt .md .csv .json .py .ts</span>
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-primary/10 border border-primary/20 text-foreground"
                    : "bg-secondary border border-border text-foreground"
                }`}>
                  {m.fileName && (
                    <p className="text-[9px] text-primary/70 mb-1 tracking-wider">📎 {m.fileName}</p>
                  )}
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-secondary border border-border rounded-lg px-3 py-2">
                  <span className="text-yellow-400 text-xs tracking-[0.3em] animate-pulse">···</span>
                </div>
              </div>
            )}
          </div>

          {/* Pending file chip */}
          {pendingFile && (
            <div className="mx-3 mb-1 flex items-center gap-2 bg-primary/5 border border-primary/20 rounded px-2 py-1 flex-shrink-0">
              {pendingFile.content === "__loading__" ? (
                <span className="text-[9px] text-yellow-400 tracking-wider flex-1 truncate animate-pulse">⏳ Extracting text from {pendingFile.name}...</span>
              ) : (
                <span className="text-[9px] text-primary tracking-wider flex-1 truncate">
                  📎 {pendingFile.name}
                  {pendingFile.name.toLowerCase().endsWith('.pdf') && (
                    <span className="ml-1 opacity-60">({Math.round(pendingFile.content.length / 1000)}k chars extracted)</span>
                  )}
                </span>
              )}
              <button onClick={() => setPendingFile(null)} className="text-muted-foreground hover:text-foreground text-[10px] leading-none">✕</button>
            </div>
          )}

          {/* File error */}
          {fileError && (
            <p className="mx-3 mb-1 text-[9px] text-red-400 tracking-wide leading-tight flex-shrink-0">{fileError}</p>
          )}

          {/* Input row */}
          <div className="flex items-center gap-1 p-2 border-t border-border flex-shrink-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              accept=".pdf,.txt,.md,.csv,.json,.py,.ts,.tsx,.js,.jsx,.html,.xml,.log,.yaml,.toml"
            />
            <button
              onClick={() => { setFileError(""); fileInputRef.current?.click() }}
              className="text-muted-foreground hover:text-primary p-1 transition-colors text-sm"
              title="Attach file"
            >
              📎
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Ask Jarvis..."
              className="flex-1 text-[11px] bg-secondary border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
            />
            <button
              onClick={send}
              disabled={loading || (!input.trim() && !pendingFile)}
              className="text-[11px] bg-primary text-primary-foreground px-2 py-1.5 rounded disabled:opacity-30 transition-opacity hover:opacity-90"
            >
              →
            </button>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        title="Jarvis Chat"
        className={[
          "w-11 h-11 rounded-full border flex items-center justify-center transition-all shadow-lg",
          isOpen
            ? "border-primary/70 bg-primary/10"
            : "border-border bg-background hover:border-primary/50 hover:bg-primary/5",
        ].join(" ")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={isOpen ? "text-primary" : "text-muted-foreground"}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

    </div>
  )
}
