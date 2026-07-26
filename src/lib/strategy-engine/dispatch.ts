// Strategy dispatch (Phase 17) — the one place that decides "what logic
// runs for this strategy ID," used by both the signal engine and the
// backtest route so `strategyId` actually selects behavior instead of being
// accepted-but-ignored.

import { db } from "@/lib/db/client"
import { checkBotSignal, DEFAULT_PARAMS, type Bar, type BotSignal } from "@/lib/backtest/bot-strategy"
import { evaluateStrategy } from "./interpreter"
import { StrategyDefinitionSchema, type StrategyDefinition } from "./schema"
import { SMC_ICT_V4_DEFINITION } from "./legacy-definition"

let definitionColumnReady = false
async function ensureDefinitionColumn(): Promise<void> {
  if (definitionColumnReady) return
  try {
    await db.execute(`ALTER TABLE strategies ADD COLUMN definition_json TEXT`)
  } catch {
    // Column already exists — the lazy-migration convention this repo uses
    // elsewhere (ensureSemanticSchema()) treats that as success, not error.
  }
  definitionColumnReady = true
}

// Per-process cache — avoids a DB round trip per bar in a tight backtest
// loop. Safe to be stale across deploys/cold starts; explicitly invalidated
// after any write via clearDefinitionCache().
const definitionCache = new Map<string, StrategyDefinition | null>()

export function clearDefinitionCache(strategyId?: string): void {
  if (strategyId) definitionCache.delete(strategyId)
  else definitionCache.clear()
}

export async function getStrategyDefinition(strategyId: string): Promise<StrategyDefinition | null> {
  return loadDefinition(strategyId)
}

async function loadDefinition(strategyId: string): Promise<StrategyDefinition | null> {
  if (definitionCache.has(strategyId)) return definitionCache.get(strategyId) ?? null

  await ensureDefinitionColumn()
  const res = await db.execute({
    sql: `SELECT definition_json FROM strategies WHERE id = ?`,
    args: [strategyId],
  })
  const raw = res.rows[0]?.definition_json as string | null | undefined

  let def: StrategyDefinition | null = null
  if (raw) {
    try {
      const parsed = StrategyDefinitionSchema.safeParse(JSON.parse(raw))
      if (parsed.success) def = parsed.data
    } catch { /* malformed JSON in the column — fall through below */ }
  }
  // smc-ict-v4 predates definition_json entirely — rather than requiring a
  // one-off production migration to backfill the column, resolve it to the
  // known-equivalent definition in memory. Any strategy inserted from here
  // on (including Phase 20's LLM-authored ones) writes definition_json for
  // real at creation time, so this special case only ever covers the one
  // legacy row.
  if (!def && strategyId === "smc-ict-v4") def = SMC_ICT_V4_DEFINITION

  definitionCache.set(strategyId, def)
  return def
}

/**
 * Resolves and runs whatever logic `strategyId` maps to for this bar.
 * Returns the same BotSignal shape regardless of whether the strategy is
 * interpreter-driven or (for a not-yet-migrated/unknown id) the legacy
 * hardcoded algorithm — callers don't need to know which.
 */
export async function getSignalForStrategy(
  strategyId: string,
  bars15m: Bar[],
  dailyBars: Bar[],
  spyBars: Bar[],
  i: number,
  symbol: string,
): Promise<BotSignal | null> {
  const def = await loadDefinition(strategyId)
  if (def) {
    return evaluateStrategy(def, { bars15m, dailyBars, spyBars, i, symbol })
  }
  // Unknown/unmigrated strategy id — safe fallback to the always-correct
  // legacy algorithm rather than silently producing no signals at all.
  return checkBotSignal(bars15m, dailyBars, spyBars, i, symbol, DEFAULT_PARAMS)
}
