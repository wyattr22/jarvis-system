import { db } from "@/lib/db/client"
import { getHoldoutBoundary } from "./holdout"

const MIN_INSTRUMENTS = 2
const MIN_PERIODS = 3
const MIN_REGIMES = 2

export interface CausalityResult {
  instruments: { name: string; r: number; n: number; pass: boolean }[]
  periods: { year: number; r: number; n: number; pass: boolean }[]
  regimes: { tag: string; r: number; n: number; pass: boolean }[]
  instrumentScore: number  // fraction of instruments where pattern holds
  periodScore: number
  regimeScore: number
  overallScore: number
  verdict: "pass" | "fail" | "insufficient_data"
}

function mean(arr: number[]) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length
}

export async function scoreCausality(
  strategyId: string,
  featureName: string,
  threshold: number
): Promise<CausalityResult> {
  const holdoutBoundary = await getHoldoutBoundary()

  const result = await db.execute({
    sql: `SELECT s.instrument, t.r_multiple, t.opened_at, t.regime_tag,
                 f.value as feature_val
          FROM trades t
          JOIN signals s ON t.signal_id = s.id
          LEFT JOIN features f ON f.instrument = s.instrument
            AND f.feature_name = ?
            AND f.timestamp <= t.opened_at
          WHERE s.strategy_id = ?
            AND t.opened_at < ?
            AND t.r_multiple IS NOT NULL
          ORDER BY t.opened_at`,
    args: [featureName, strategyId, holdoutBoundary],
  })

  const trades = result.rows.map(r => ({
    instrument: r.instrument as string,
    r: r.r_multiple as number,
    openedAt: r.opened_at as number,
    regime: (r.regime_tag as string) ?? "unknown",
    featureVal: r.feature_val as number | null,
  }))

  // Filter to trades where feature exceeds threshold
  const filtered = trades.filter(t => t.featureVal !== null && t.featureVal >= threshold)

  if (filtered.length < 20) {
    return {
      instruments: [], periods: [], regimes: [],
      instrumentScore: 0, periodScore: 0, regimeScore: 0, overallScore: 0,
      verdict: "insufficient_data",
    }
  }

  // ── By instrument ────────────────────────────────────────────
  const byInstrument = new Map<string, number[]>()
  filtered.forEach(t => {
    if (!byInstrument.has(t.instrument)) byInstrument.set(t.instrument, [])
    byInstrument.get(t.instrument)!.push(t.r)
  })
  const instrumentResults = Array.from(byInstrument.entries()).map(([name, rs]) => ({
    name,
    r: mean(rs),
    n: rs.length,
    pass: rs.length >= 5 && mean(rs) > 0,
  }))

  // ── By year ───────────────────────────────────────────────────
  const byYear = new Map<number, number[]>()
  filtered.forEach(t => {
    const year = new Date(t.openedAt).getFullYear()
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)!.push(t.r)
  })
  const periodResults = Array.from(byYear.entries()).map(([year, rs]) => ({
    year,
    r: mean(rs),
    n: rs.length,
    pass: rs.length >= 5 && mean(rs) > 0,
  })).sort((a, b) => a.year - b.year)

  // ── By regime ─────────────────────────────────────────────────
  const byRegime = new Map<string, number[]>()
  filtered.forEach(t => {
    if (!byRegime.has(t.regime)) byRegime.set(t.regime, [])
    byRegime.get(t.regime)!.push(t.r)
  })
  const regimeResults = Array.from(byRegime.entries()).map(([tag, rs]) => ({
    tag,
    r: mean(rs),
    n: rs.length,
    pass: rs.length >= 5 && mean(rs) > 0,
  }))

  const passingInstruments = instrumentResults.filter(r => r.pass).length
  const passingPeriods = periodResults.filter(r => r.pass).length
  const passingRegimes = regimeResults.filter(r => r.pass).length

  const instrumentScore = instrumentResults.length > 0 ? passingInstruments / instrumentResults.length : 0
  const periodScore = periodResults.length > 0 ? passingPeriods / periodResults.length : 0
  const regimeScore = regimeResults.length > 0 ? passingRegimes / regimeResults.length : 0
  const overallScore = (instrumentScore + periodScore + regimeScore) / 3

  const hasEnoughInstruments = instrumentResults.length >= MIN_INSTRUMENTS && passingInstruments >= MIN_INSTRUMENTS
  const hasEnoughPeriods = periodResults.length >= MIN_PERIODS && passingPeriods >= MIN_PERIODS
  const hasEnoughRegimes = regimeResults.length >= MIN_REGIMES && passingRegimes >= MIN_REGIMES

  const verdict = hasEnoughInstruments && hasEnoughPeriods && hasEnoughRegimes
    ? "pass"
    : "fail"

  return {
    instruments: instrumentResults,
    periods: periodResults,
    regimes: regimeResults,
    instrumentScore,
    periodScore,
    regimeScore,
    overallScore,
    verdict,
  }
}
