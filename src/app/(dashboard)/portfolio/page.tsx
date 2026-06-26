"use client"

import { useEffect, useState, useRef } from "react"

type Position = {
  symbol: string
  side: string
  qty: string
  avg_entry_price: string
  current_price: string
  unrealized_pl: string
  unrealized_plpc: string
  market_value: string
  cost_basis: string
}

type Account = {
  equity: string
  cash: string
  buying_power: string
  portfolio_value: string
  unrealized_pl: string
  unrealized_plpc: string
  long_market_value: string
}

type ImportedTrade = {
  symbol: string
  side: string
  qty: number
  price: number
  total: number
  date: string
}

export default function PortfolioPage() {
  const [account, setAccount] = useState<Account | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [importedTrades, setImportedTrades] = useState<ImportedTrade[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/bot")
      const json = await res.json()
      setAccount(json.account)
      setPositions(json.positions ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string
        const lines = text.split("\n").filter(l => l.trim())
        if (lines.length < 2) { setImportError("CSV appears empty"); return }

        const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ""))
        const trades: ImportedTrade[] = []

        for (const line of lines.slice(1)) {
          const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""))
          const row: Record<string, string> = {}
          headers.forEach((h, i) => { row[h] = cols[i] ?? "" })

          // Support both Webull and Alpaca CSV formats
          const symbol = row["symbol"] ?? row["ticker"] ?? ""
          const side = (row["side"] ?? row["action"] ?? "buy").toLowerCase()
          const qty = parseFloat(row["qty"] ?? row["quantity"] ?? row["shares"] ?? "0")
          const price = parseFloat(row["price"] ?? row["avg_price"] ?? row["filled_avg_price"] ?? "0")
          const date = row["date"] ?? row["submitted_at"] ?? row["time"] ?? ""

          if (symbol && !isNaN(qty) && !isNaN(price)) {
            trades.push({ symbol, side, qty, price, total: qty * price, date })
          }
        }

        setImportedTrades(trades)
      } catch (err) {
        setImportError(String(err))
      }
    }
    reader.readAsText(file)
  }

  const equity = account ? parseFloat(account.equity) : null
  const unrealizedPL = account ? parseFloat(account.unrealized_pl ?? "0") : null
  const unrealizedPct = account ? parseFloat(account.unrealized_plpc ?? "0") * 100 : null

  const totalPositionValue = positions.reduce((sum, p) => sum + parseFloat(p.market_value), 0)

  return (
    <div className="p-6 space-y-6">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Portfolio</h1>
          <p className="text-xs text-muted-foreground mt-1">Alpaca paper account · live positions</p>
        </div>
        <button
          onClick={load}
          className="text-[10px] tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
        >
          REFRESH
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
        </div>
      ) : (
        <>
          {/* Account summary */}
          {account && (
            <div>
              <p className="text-[10px] text-muted-foreground tracking-widest mb-2">ACCOUNT SUMMARY</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="EQUITY" value={equity ? `$${equity.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"} />
                <StatCard label="CASH" value={`$${parseFloat(account.cash).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
                <StatCard
                  label="UNREALIZED P&L"
                  value={unrealizedPL !== null ? `${unrealizedPL >= 0 ? "+" : ""}$${unrealizedPL.toFixed(2)}` : "—"}
                  positive={unrealizedPL !== null ? unrealizedPL >= 0 : undefined}
                />
                <StatCard
                  label="RETURN"
                  value={unrealizedPct !== null ? `${unrealizedPct >= 0 ? "+" : ""}${unrealizedPct.toFixed(2)}%` : "—"}
                  positive={unrealizedPct !== null ? unrealizedPct >= 0 : undefined}
                />
              </div>
            </div>
          )}

          {/* Open positions */}
          <div>
            <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
              POSITIONS · ${totalPositionValue.toLocaleString("en-US", { minimumFractionDigits: 2 })} invested
            </p>
            {positions.length === 0 ? (
              <div className="border border-dashed rounded p-6 text-center text-xs text-muted-foreground tracking-widest">
                NO OPEN POSITIONS
              </div>
            ) : (
              <div className="space-y-2">
                {positions.map(p => {
                  const pl = parseFloat(p.unrealized_pl)
                  const plPct = parseFloat(p.unrealized_plpc) * 100
                  const marketValue = parseFloat(p.market_value)
                  const pct = totalPositionValue > 0 ? (marketValue / totalPositionValue) * 100 : 0

                  return (
                    <div key={p.symbol} className="border border-border rounded p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-foreground">{p.symbol}</span>
                          <span className={`text-[10px] tracking-widest ${p.side === "long" ? "text-primary" : "text-red-400"}`}>
                            {p.side.toUpperCase()}
                          </span>
                          <span className="text-xs text-muted-foreground">{p.qty} shares</span>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-medium ${pl >= 0 ? "text-primary" : "text-red-400"}`}>
                            {pl >= 0 ? "+" : ""}${pl.toFixed(2)}
                          </p>
                          <p className={`text-[10px] ${pl >= 0 ? "text-primary" : "text-red-400"}`}>
                            {plPct >= 0 ? "+" : ""}{plPct.toFixed(2)}%
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                        <span>ENTRY ${parseFloat(p.avg_entry_price).toFixed(2)}</span>
                        <span>CURRENT ${parseFloat(p.current_price).toFixed(2)}</span>
                        <span>VALUE ${marketValue.toFixed(2)}</span>
                        <span className="ml-auto">{pct.toFixed(1)}% OF PORTFOLIO</span>
                      </div>

                      {/* Position weight bar */}
                      <div className="mt-2 h-0.5 bg-border rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pl >= 0 ? "bg-primary" : "bg-red-400"}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Webull/CSV import */}
          <div>
            <p className="text-[10px] text-muted-foreground tracking-widest mb-2">IMPORT TRADES (CSV)</p>
            <div className="border border-dashed border-border rounded p-4">
              <p className="text-xs text-muted-foreground mb-3">
                Import trade history from Webull, Alpaca, or any broker CSV. Columns needed: symbol, side, qty, price, date.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleCsvImport}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="text-[10px] tracking-widest border border-border rounded px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
              >
                SELECT CSV FILE
              </button>

              {importError && (
                <p className="text-xs text-red-400 mt-2">{importError}</p>
              )}

              {importedTrades.length > 0 && (
                <div className="mt-4">
                  <p className="text-[10px] text-muted-foreground tracking-widest mb-2">
                    {importedTrades.length} TRADES PARSED
                  </p>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] text-muted-foreground tracking-widest border-b border-border">
                          <th className="text-left pb-1">SYMBOL</th>
                          <th className="text-left pb-1">SIDE</th>
                          <th className="text-right pb-1">QTY</th>
                          <th className="text-right pb-1">PRICE</th>
                          <th className="text-right pb-1">TOTAL</th>
                          <th className="text-right pb-1">DATE</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {importedTrades.map((t, i) => (
                          <tr key={i}>
                            <td className="py-1 font-medium">{t.symbol}</td>
                            <td className={`py-1 ${t.side.includes("buy") ? "text-primary" : "text-red-400"}`}>
                              {t.side.toUpperCase()}
                            </td>
                            <td className="py-1 text-right">{t.qty}</td>
                            <td className="py-1 text-right">${t.price.toFixed(2)}</td>
                            <td className="py-1 text-right">${t.total.toFixed(2)}</td>
                            <td className="py-1 text-right text-muted-foreground text-[10px]">{t.date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="bg-secondary border border-border rounded p-3">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className={`text-sm font-medium mt-1 ${
        positive === undefined ? "text-foreground" :
        positive ? "text-primary" : "text-red-400"
      }`}>
        {value}
      </p>
    </div>
  )
}
