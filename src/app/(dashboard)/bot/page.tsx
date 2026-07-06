"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type AlpacaAccount = {
  equity: string
  cash: string
  buying_power: string
  portfolio_value: string
  daytrade_count: number
  pattern_day_trader: boolean
  trading_blocked: boolean
  account_blocked: boolean
}

type Position = {
  symbol: string
  side: string
  qty: string
  avg_entry_price: string
  current_price: string
  unrealized_pl: string
  unrealized_plpc: string
  market_value: string
}

type Order = {
  id: string
  symbol: string
  side: string
  type: string
  qty: string
  filled_qty: string
  filled_avg_price: string
  status: string
  submitted_at: string
}

type Strategy = {
  id: string
  name: string
  enabled: number
  capital_tier: number
  created_at: number
}

type Signal = {
  id: string
  instrument: string
  direction: string
  entry: number | null
  stop: number | null
  target: number | null
  confidence: number | null
  status: string
  created_at: number
  r_multiple: number | null
  pnl: number | null
}

type BotData = {
  account: AlpacaAccount | null
  positions: Position[]
  orders: Order[]
  strategies: Strategy[]
  error: string | null
}

const TIER_LABEL = ["INACTIVE", "1% PAPER", "5% LIVE", "FULL"]

const ORDER_STATUS_COLOR: Record<string, string> = {
  filled:        "text-primary",
  partially_filled: "text-yellow-400",
  new:           "text-blue-400",
  canceled:      "text-muted-foreground",
  rejected:      "text-red-400",
  pending_new:   "text-blue-400",
}

const SIGNAL_STATUS_COLOR: Record<string, string> = {
  pending: "text-yellow-400",
  filled: "text-primary",
  cancelled: "text-muted-foreground",
  expired: "text-muted-foreground",
}

export default function BotStatusPage() {
  const [data, setData] = useState<BotData | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [botRes, sigRes] = await Promise.all([
        fetch("/api/bot"),
        fetch("/api/signals"),
      ])
      setData(await botRes.json())
      const sigData = await sigRes.json()
      setSignals(sigData.signals ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleStrategy(strategyId: string, currentEnabled: number) {
    setActing(strategyId)
    await fetch("/api/bot", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyId,
        action: currentEnabled ? "pause" : "resume",
      }),
    })
    await load()
    setActing(null)
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-xs text-muted-foreground tracking-widest">LOADING...</p>
      </div>
    )
  }

  const { account, positions, orders, strategies, error } = data ?? {}

  const equity = account ? parseFloat(account.equity) : null
  const cash = account ? parseFloat(account.cash) : null
  const pv = account ? parseFloat(account.portfolio_value) : null
  const daytradeCount = account?.daytrade_count ?? 0
  const blocked = account?.trading_blocked || account?.account_blocked

  return (
    <div className="p-6 space-y-6">
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase">Bot Status</h1>
          <p className="text-xs text-muted-foreground mt-1">Alpaca paper account · live positions · kill switches</p>
        </div>
        <div className="flex items-center gap-2">
          <AutoExecuteBadge />
          <button
            onClick={load}
            className="text-[10px] tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
          >
            REFRESH
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-400/30 bg-red-400/5 p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Account stats */}
      {account && (
        <div>
          <p className="text-[10px] text-muted-foreground tracking-widest mb-2">ACCOUNT</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="EQUITY" value={equity ? `$${equity.toFixed(2)}` : "—"} />
            <StatCard label="CASH" value={cash ? `$${cash.toFixed(2)}` : "—"} />
            <StatCard
              label="DAY TRADES"
              value={`${daytradeCount}/3`}
              warn={daytradeCount >= 3}
            />
            <StatCard
              label="STATUS"
              value={blocked ? "BLOCKED" : "ACTIVE"}
              warn={!!blocked}
              ok={!blocked}
            />
          </div>
        </div>
      )}

      {/* Strategies / Kill switches */}
      <div>
        <p className="text-[10px] text-muted-foreground tracking-widest mb-2">STRATEGIES</p>
        {!strategies?.length ? (
          <div className="border border-dashed rounded p-4 text-center text-xs text-muted-foreground tracking-widest">
            NO STRATEGIES FOUND
          </div>
        ) : (
          <div className="space-y-2">
            {strategies.map(s => (
              <div key={s.id} className="flex items-center justify-between border border-border rounded p-3">
                <div>
                  <p className="text-xs font-medium text-foreground">{s.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {s.id} · {TIER_LABEL[s.capital_tier] ?? `Tier ${s.capital_tier}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={`text-[9px] ${s.enabled ? "text-primary border-primary/30" : "text-yellow-400 border-yellow-400/30"}`}>
                    {s.enabled ? "ENABLED" : "PAUSED"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleStrategy(s.id, s.enabled)}
                    disabled={acting === s.id}
                    className={`text-[10px] tracking-widest h-7 px-2 ${
                      s.enabled
                        ? "text-yellow-400 border-yellow-400/30 hover:bg-yellow-400/10"
                        : "text-primary border-primary/30 hover:bg-primary/10"
                    }`}
                  >
                    {acting === s.id ? "..." : s.enabled ? "PAUSE" : "RESUME"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open positions */}
      <div>
        <p className="text-[10px] text-muted-foreground tracking-widest mb-2">POSITIONS</p>
        {!positions?.length ? (
          <div className="border border-dashed rounded p-4 text-center text-xs text-muted-foreground tracking-widest">
            NO OPEN POSITIONS
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground tracking-widest border-b border-border">
                  <th className="text-left pb-2">SYMBOL</th>
                  <th className="text-left pb-2">SIDE</th>
                  <th className="text-right pb-2">QTY</th>
                  <th className="text-right pb-2">ENTRY</th>
                  <th className="text-right pb-2">CURRENT</th>
                  <th className="text-right pb-2">P&L</th>
                  <th className="text-right pb-2">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {positions.map(pos => {
                  const pl = parseFloat(pos.unrealized_pl)
                  const plPct = parseFloat(pos.unrealized_plpc) * 100
                  const plColor = pl >= 0 ? "text-primary" : "text-red-400"
                  return (
                    <tr key={pos.symbol} className="py-2">
                      <td className="py-2 font-medium">{pos.symbol}</td>
                      <td className={`py-2 ${pos.side === "long" ? "text-primary" : "text-red-400"}`}>
                        {pos.side.toUpperCase()}
                      </td>
                      <td className="py-2 text-right">{pos.qty}</td>
                      <td className="py-2 text-right">${parseFloat(pos.avg_entry_price).toFixed(2)}</td>
                      <td className="py-2 text-right">${parseFloat(pos.current_price).toFixed(2)}</td>
                      <td className={`py-2 text-right ${plColor}`}>${pl.toFixed(2)}</td>
                      <td className={`py-2 text-right ${plColor}`}>{plPct.toFixed(2)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Signal feed */}
      <div>
        <p className="text-[10px] text-muted-foreground tracking-widest mb-2">SIGNAL FEED</p>
        {!signals.length ? (
          <div className="border border-dashed rounded p-4 text-center text-xs text-muted-foreground tracking-widest">
            NO SIGNALS — bot.py must push via /api/ingest-signal
          </div>
        ) : (
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="text-[10px] text-muted-foreground tracking-widest border-b border-border">
                  <th className="text-left pb-2">SYMBOL</th>
                  <th className="text-left pb-2">DIR</th>
                  <th className="text-right pb-2">ENTRY</th>
                  <th className="text-right pb-2">STOP</th>
                  <th className="text-right pb-2">TARGET</th>
                  <th className="text-right pb-2">CONF</th>
                  <th className="text-left pb-2 pl-3">STATUS</th>
                  <th className="text-right pb-2">R</th>
                  <th className="text-right pb-2">TIME</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {signals.map(sig => (
                  <tr key={sig.id}>
                    <td className="py-1.5 font-medium">{sig.instrument}</td>
                    <td className={`py-1.5 ${sig.direction === "long" ? "text-primary" : "text-red-400"}`}>
                      {sig.direction.toUpperCase()}
                    </td>
                    <td className="py-1.5 text-right">{sig.entry != null ? `$${sig.entry.toFixed(2)}` : "—"}</td>
                    <td className="py-1.5 text-right text-red-400/70">{sig.stop != null ? `$${sig.stop.toFixed(2)}` : "—"}</td>
                    <td className="py-1.5 text-right text-primary/70">{sig.target != null ? `$${sig.target.toFixed(2)}` : "—"}</td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {sig.confidence != null ? `${(sig.confidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className={`py-1.5 pl-3 ${SIGNAL_STATUS_COLOR[sig.status] ?? "text-muted-foreground"}`}>
                      {sig.status.toUpperCase()}
                    </td>
                    <td className={`py-1.5 text-right ${sig.r_multiple != null ? (sig.r_multiple >= 0 ? "text-primary" : "text-red-400") : "text-muted-foreground"}`}>
                      {sig.r_multiple != null ? `${sig.r_multiple >= 0 ? "+" : ""}${sig.r_multiple.toFixed(2)}R` : "—"}
                    </td>
                    <td className="py-1.5 text-right text-[10px] text-muted-foreground">
                      {new Date(sig.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent orders */}
      <div>
        <p className="text-[10px] text-muted-foreground tracking-widest mb-2">RECENT ORDERS</p>
        {!orders?.length ? (
          <div className="border border-dashed rounded p-4 text-center text-xs text-muted-foreground tracking-widest">
            NO ORDERS
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground tracking-widest border-b border-border">
                  <th className="text-left pb-2">SYMBOL</th>
                  <th className="text-left pb-2">SIDE</th>
                  <th className="text-left pb-2">TYPE</th>
                  <th className="text-right pb-2">QTY</th>
                  <th className="text-right pb-2">FILLED</th>
                  <th className="text-right pb-2">PRICE</th>
                  <th className="text-left pb-2 pl-3">STATUS</th>
                  <th className="text-right pb-2">TIME</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map(o => (
                  <tr key={o.id}>
                    <td className="py-2 font-medium">{o.symbol}</td>
                    <td className={`py-2 ${o.side === "buy" ? "text-primary" : "text-red-400"}`}>
                      {o.side.toUpperCase()}
                    </td>
                    <td className="py-2 text-muted-foreground">{o.type}</td>
                    <td className="py-2 text-right">{o.qty}</td>
                    <td className="py-2 text-right">{o.filled_qty ?? "—"}</td>
                    <td className="py-2 text-right">
                      {o.filled_avg_price ? `$${parseFloat(o.filled_avg_price).toFixed(2)}` : "—"}
                    </td>
                    <td className={`py-2 pl-3 ${ORDER_STATUS_COLOR[o.status] ?? "text-muted-foreground"}`}>
                      {o.status.replace(/_/g, " ").toUpperCase()}
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {new Date(o.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, warn, ok }: { label: string; value: string; warn?: boolean; ok?: boolean }) {
  return (
    <div className="bg-secondary rounded p-3 border border-border">
      <p className="text-[9px] text-muted-foreground tracking-widest">{label}</p>
      <p className={`text-sm font-medium mt-1 ${warn ? "text-red-400" : ok ? "text-primary" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  )
}

// Auto-execute master-switch status (12.8). Read-only here — the toggle
// lives on /risk-config (writes need CRON_SECRET).
function AutoExecuteBadge() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    fetch("/api/admin/risk-config")
      .then(r => r.json())
      .then(d => setEnabled(d.config?.auto_execute === true))
      .catch(() => setEnabled(null))
  }, [])
  if (enabled === null) return null
  return (
    <Link
      href="/risk-config"
      title="Auto-execution master switch — toggle on Risk Config"
      className={`text-[9px] tracking-widest border rounded px-2 py-1 ${
        enabled ? "text-primary border-primary/40" : "text-yellow-400 border-yellow-400/30"
      }`}
    >
      AUTO-EXECUTE {enabled ? "ON" : "OFF"}
    </Link>
  )
}
