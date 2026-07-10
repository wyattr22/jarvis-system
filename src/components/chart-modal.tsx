"use client"

// TradingView chart popup for /markets (12.1).
// Mount <ChartModal /> once per page; open it from anywhere with:
//   window.dispatchEvent(new CustomEvent("jarvis:openChartModal", { detail: { symbol } }))
// Reuses the same free tv.js widget as /charts. "Full chart →" hands the
// symbol to /charts via the existing localStorage + jarvis:loadChart contract.

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toTradingViewSymbol } from "@/lib/instruments/tv-symbols"

// charts/page.tsx already declares Window.TradingView globally with its own
// widget type — access it loosely here to avoid conflicting declarations.
function tv(): { widget: new (cfg: Record<string, unknown>) => unknown } | undefined {
  return (window as unknown as { TradingView?: { widget: new (cfg: Record<string, unknown>) => unknown } }).TradingView
}

export function openChartModal(symbol: string) {
  window.dispatchEvent(new CustomEvent("jarvis:openChartModal", { detail: { symbol } }))
}

export function ChartModal() {
  const [symbol, setSymbol] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { symbol?: string }
      if (detail?.symbol) setSymbol(detail.symbol)
    }
    window.addEventListener("jarvis:openChartModal", handler)
    return () => window.removeEventListener("jarvis:openChartModal", handler)
  }, [])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSymbol(null)
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [])

  // (Re)create the widget whenever the modal opens with a symbol
  useEffect(() => {
    if (!symbol || !containerRef.current) return
    const uid = `tv-modal-${Date.now()}`
    containerRef.current.innerHTML = ""
    const el = document.createElement("div")
    el.id = uid
    el.style.cssText = "width:100%;height:100%"
    containerRef.current.appendChild(el)

    const tvSymbol = toTradingViewSymbol(symbol)
    function create() {
      const TV = tv()
      if (!TV) return
      new TV.widget({
        autosize: true,
        symbol: tvSymbol,
        interval: "15",
        timezone: "America/New_York",
        theme: "dark",
        style: "1",
        locale: "en",
        toolbar_bg: "#080d14",
        enable_publishing: false,
        allow_symbol_change: true,
        container_id: uid,
        overrides: {
          "paneProperties.background": "#080d14",
          "paneProperties.backgroundType": "solid",
        },
        loading_screen: { backgroundColor: "#080d14", foregroundColor: "#00d4a1" },
      })
    }

    if (tv()) {
      create()
    } else if (!document.getElementById("tv-script")) {
      const s = document.createElement("script")
      s.id = "tv-script"
      s.src = "https://s3.tradingview.com/tv.js"
      s.async = true
      s.onload = create
      document.head.appendChild(s)
    } else {
      const poll = setInterval(() => {
        if (tv()) {
          clearInterval(poll)
          create()
        }
      }, 80)
      return () => clearInterval(poll)
    }
  }, [symbol])

  const openFullChart = useCallback(() => {
    if (!symbol) return
    // /charts expects a plain tradable ticker; TV-mapped symbols still work
    // because the widget accepts them via allow_symbol_change.
    const tvSym = toTradingViewSymbol(symbol)
    localStorage.setItem("jarvis_chart_symbol", tvSym)
    window.dispatchEvent(new CustomEvent("jarvis:loadChart", { detail: { symbol: tvSym } }))
    setSymbol(null)
    router.push("/charts")
  }, [symbol, router])

  if (!symbol) return null

  return (
    <div
      onClick={() => setSymbol(null)}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(4, 8, 14, 0.82)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)", height: "min(680px, 86vh)",
          background: "var(--background)", border: "1px solid var(--border)", borderRadius: 10,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
          <b style={{ color: "#e5e7eb", fontSize: 13 }}>{symbol}</b>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={openFullChart}
              style={{ background: "transparent", color: "#00d4a1", border: "1px solid #00d4a133", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
            >
              Full chart →
            </button>
            <button
              onClick={() => setSymbol(null)}
              aria-label="Close"
              style={{ background: "transparent", color: "#9ca3af", border: "none", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        </div>
        <div ref={containerRef} style={{ flex: 1 }} />
      </div>
    </div>
  )
}

/** Client wrapper that makes any tile open the chart popup on click. */
export function ChartTile({ symbol, children }: { symbol: string; children: React.ReactNode }) {
  return (
    <div
      onClick={() => openChartModal(symbol)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && openChartModal(symbol)}
      className="jarvis-tile"
      title={`Open ${symbol} chart`}
    >
      {children}
    </div>
  )
}
