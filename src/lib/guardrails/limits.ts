// Hard caps — these are constants, not config. No agent can override them.
export const LIMITS = {
  MAX_DAILY_LOSS_PCT: 0.02,      // 2% of account equity
  MAX_POSITION_SIZE_PCT: 0.05,   // 5% per position
  MAX_RISK_PER_TRADE_PCT: 0.03,  // 3% max risk per trade
  CAPITAL_TIER_1_PCT: 0.01,      // 1% — tier 1 strategies
  CAPITAL_TIER_2_PCT: 0.05,      // 5% — tier 2 strategies
  CAPITAL_TIER_FULL: 1.0,        // full allocation — promoted strategies
  MIN_R_RATIO: 2.0,              // minimum R:R to take a trade
  DRIFT_SIGMA_THRESHOLD: 2.0,    // sigma deviation before auto-pause
  DRIFT_TRADE_WINDOW: 20,        // trades to measure drift over
  SHADOW_MIN_TRADES: 50,         // shadow trades required before promotion
  SHADOW_P_VALUE: 0.05,          // p-value threshold for promotion
  TIER_1_PROFITABLE_TRADES: 30,  // trades needed to advance from tier 1→2
  TIER_2_PROFITABLE_TRADES: 90,  // trades needed to advance from tier 2→full
  TIER_MIN_SHARPE: 1.0,          // Sharpe required to advance tiers
} as const

export function checkPositionSize(
  accountEquity: number,
  proposedSize: number,
  capitalTier: number
): { allowed: boolean; maxAllowed: number; reason?: string } {
  const tierPct =
    capitalTier === 1
      ? LIMITS.CAPITAL_TIER_1_PCT
      : capitalTier === 2
      ? LIMITS.CAPITAL_TIER_2_PCT
      : LIMITS.CAPITAL_TIER_FULL

  const maxAbsolute = accountEquity * LIMITS.MAX_POSITION_SIZE_PCT
  const maxTier = accountEquity * tierPct
  const maxAllowed = Math.min(maxAbsolute, maxTier)

  if (proposedSize > maxAllowed) {
    return {
      allowed: false,
      maxAllowed,
      reason: `Position size $${proposedSize.toFixed(2)} exceeds cap $${maxAllowed.toFixed(2)} (tier ${capitalTier})`,
    }
  }
  return { allowed: true, maxAllowed }
}

export function checkDailyLoss(
  accountEquity: number,
  dailyPnl: number
): { breached: boolean; remaining: number } {
  const maxLoss = accountEquity * LIMITS.MAX_DAILY_LOSS_PCT
  const remaining = maxLoss + dailyPnl // dailyPnl is negative when losing
  return {
    breached: dailyPnl <= -maxLoss,
    remaining: Math.max(0, remaining),
  }
}
