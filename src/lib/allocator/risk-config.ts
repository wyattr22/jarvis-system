// Risk configuration — single source of truth for portfolio risk caps.
//
// Stored as a single-row table (id=1) so updates are atomic and there's
// no ambiguity about which config is "current". Defaults are conservative:
// 1% risk per trade, 3% max daily loss, 10 max open positions, 25% per
// asset class.

import { db } from "@/lib/db/client"

export type RiskConfig = {
  equity_override?: number             // override account equity (for testing); null = use live broker
  max_risk_per_trade_pct: number       // 0..1 (1% = 0.01)
  max_daily_loss_pct: number           // 0..1
  max_open_positions: number
  max_correlated_exposure_pct: number  // 0..1
  asset_class_caps: Record<string, number>  // assetClass → max % of equity
  kelly_fraction_cap: number           // never bet more than this fraction of Kelly (e.g. 0.25 = quarter-Kelly)
  updated_at: number
}

const DEFAULTS: RiskConfig = {
  max_risk_per_trade_pct: 0.01,
  max_daily_loss_pct: 0.03,
  max_open_positions: 10,
  max_correlated_exposure_pct: 0.25,
  asset_class_caps: {
    equity: 0.50,
    crypto: 0.10,
    futures: 0.30,
    forex: 0.10,
    options: 0.10,
    prediction: 0.05,
  },
  kelly_fraction_cap: 0.25,
  updated_at: 0,
}

let tableReady = false
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS risk_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  tableReady = true
}

export async function getRiskConfig(): Promise<RiskConfig> {
  await ensureTable()
  const r = await db.execute({ sql: `SELECT config_json, updated_at FROM risk_config WHERE id = 1`, args: [] })
  if (!r.rows.length) {
    // Seed defaults on first read so callers always get a config back.
    await seedDefaults()
    return { ...DEFAULTS, updated_at: Date.now() }
  }
  const row = r.rows[0] as unknown as { config_json: string; updated_at: number }
  try {
    const parsed = JSON.parse(row.config_json) as RiskConfig
    return { ...parsed, updated_at: Number(row.updated_at) }
  } catch {
    return { ...DEFAULTS, updated_at: Number(row.updated_at) }
  }
}

export async function seedDefaults(): Promise<void> {
  await ensureTable()
  const now = Date.now()
  await db.execute({
    sql: `INSERT OR REPLACE INTO risk_config (id, config_json, updated_at) VALUES (1, ?, ?)`,
    args: [JSON.stringify({ ...DEFAULTS, updated_at: now }), now],
  })
}

export async function updateRiskConfig(patch: Partial<RiskConfig>): Promise<RiskConfig> {
  const current = await getRiskConfig()
  const next: RiskConfig = {
    ...current,
    ...patch,
    asset_class_caps: { ...current.asset_class_caps, ...(patch.asset_class_caps ?? {}) },
    updated_at: Date.now(),
  }
  await ensureTable()
  await db.execute({
    sql: `INSERT OR REPLACE INTO risk_config (id, config_json, updated_at) VALUES (1, ?, ?)`,
    args: [JSON.stringify(next), next.updated_at],
  })
  return next
}

export const DEFAULT_RISK_CONFIG = DEFAULTS
