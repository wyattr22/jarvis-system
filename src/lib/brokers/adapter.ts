// Broker abstraction.
//
// Every asset class (equity, futures, forex, crypto, options, prediction)
// plugs in via a BrokerAdapter implementation. The allocator and trade
// route dispatch by `assetClass` to the right adapter so jarvis doesn't
// care whether a position is shares of TSLA, an ES future, or an EURUSD
// forex pair — it just calls `place(order)`.
//
// Today only AlpacaAdapter (equity + crypto) is implemented. Futures + forex
// land as separate PRs once a broker is picked (Tradier, Tradovate, Oanda,
// etc.). The stubs throw `not implemented` so the type system enforces the
// abstraction even before the providers exist.

export type AssetClass = "equity" | "futures" | "forex" | "crypto" | "options" | "prediction"

export type Side = "buy" | "sell"
export type OrderType = "market" | "limit"
export type TimeInForce = "day" | "gtc" | "ioc"

export type UnifiedOrder = {
  symbol: string                  // broker-specific (e.g. 'TSLA', 'ES', 'EUR_USD')
  side: Side
  qty: number
  type: OrderType
  limit_price?: number            // required when type='limit'
  stop_price?: number             // optional protective stop (bracket order)
  take_profit?: number            // optional target (bracket order)
  time_in_force?: TimeInForce
  client_order_id?: string        // for idempotency
}

export type OrderResult = {
  ok: boolean
  broker: string
  order_id?: string
  status?: string                  // broker-native status string
  error?: string
}

export type Quote = {
  symbol: string
  bid: number
  ask: number
  mid: number
  timestamp: string
}

export type Bar = {
  t: string
  o: number; h: number; l: number; c: number
  v: number
}

export type Position = {
  symbol: string
  qty: number
  avg_entry_price: number
  unrealized_pl: number
  side: "long" | "short"
}

export type AccountSnapshot = {
  broker: string
  equity: number
  cash: number
  buying_power: number
  day_pnl: number
  currency: string
  /** Broker's rolling day-trade count (PDT guard, 14.2); 0 when unsupported */
  daytrade_count: number
}

export interface BrokerAdapter {
  /** Identifying tag — used by the registry. */
  readonly id: string
  /** Which asset class this adapter handles. */
  readonly assetClass: AssetClass
  /** Human-readable. */
  readonly displayName: string

  quote(symbol: string): Promise<Quote>
  bars(symbol: string, timeframe: string, limit: number): Promise<Bar[]>
  place(order: UnifiedOrder): Promise<OrderResult>
  positions(): Promise<Position[]>
  account(): Promise<AccountSnapshot>
  /** Market-hours check. Adapters may always-true for 24/7 markets like crypto. */
  isOpen(): Promise<boolean>
}

/** Convenience: throw a unified "not implemented" error for stub adapters. */
export function notImplemented(method: string, adapter: string): never {
  const err = new Error(`${adapter}.${method} is not implemented yet`)
  ;(err as Error & { code?: string }).code = "ADAPTER_NOT_IMPLEMENTED"
  throw err
}
