// Forex majors. Activates when FINNHUB_API_KEY is deployed and the 11.3
// Finnhub provider lands — until then this renders an honest setup note
// rather than fake data.

export async function ForexGrid() {
  if (!process.env.FINNHUB_API_KEY) {
    return (
      <div style={{ color: "#9ca3af", fontSize: 12, padding: 12, border: "1px dashed #1f2937", borderRadius: 8 }}>
        Forex grid activates with a <code style={{ color: "#e5e7eb" }}>FINNHUB_API_KEY</code> —
        free at finnhub.io, no card. Add it to Vercel env + .env.local, then step 11.3 wires
        real-time majors here (EUR/USD, USD/JPY, GBP/USD, …).
      </div>
    )
  }
  // Key present but provider not wired yet (11.3 pending)
  return (
    <div style={{ color: "#9ca3af", fontSize: 12, padding: 12, border: "1px dashed #1f2937", borderRadius: 8 }}>
      FINNHUB_API_KEY detected — forex majors go live when step 11.3 (Finnhub provider) merges.
    </div>
  )
}
