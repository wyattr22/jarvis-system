import { db } from "@/lib/db/client"

export interface CorrelationEntry {
  strategyA: string
  strategyB: string
  regimeTag: string
  correlation: number
  sampleSize: number
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 5) return 0
  const xMean = xs.reduce((s, v) => s + v, 0) / n
  const yMean = ys.reduce((s, v) => s + v, 0) / n
  let num = 0, xStd = 0, yStd = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean)
    xStd += Math.pow(xs[i] - xMean, 2)
    yStd += Math.pow(ys[i] - yMean, 2)
  }
  const denom = Math.sqrt(xStd * yStd)
  return denom === 0 ? 0 : num / denom
}

export async function computeCorrelationMatrix(): Promise<CorrelationEntry[]> {
  const strategiesRow = await db.execute("SELECT id FROM strategies WHERE enabled = 1")
  const strategyIds = strategiesRow.rows.map(r => r.id as string)

  if (strategyIds.length < 2) return []

  const entries: CorrelationEntry[] = []

  for (let i = 0; i < strategyIds.length; i++) {
    for (let j = i + 1; j < strategyIds.length; j++) {
      const a = strategyIds[i]
      const b = strategyIds[j]

      // Get aligned daily P&L series for both strategies
      const pnlA = await getDailyPnl(a)
      const pnlB = await getDailyPnl(b)

      // Align by date
      const datesA = new Set(pnlA.map(p => p.date))
      const datesB = new Set(pnlB.map(p => p.date))
      const shared = [...datesA].filter(d => datesB.has(d)).sort()

      if (shared.length < 10) continue

      const xs = shared.map(d => pnlA.find(p => p.date === d)!.pnl)
      const ys = shared.map(d => pnlB.find(p => p.date === d)!.pnl)

      const correlation = pearson(xs, ys)

      const entry: CorrelationEntry = {
        strategyA: a,
        strategyB: b,
        regimeTag: "all",
        correlation,
        sampleSize: shared.length,
      }

      await db.execute({
        sql: `INSERT OR REPLACE INTO correlation_matrix
              (strategy_a, strategy_b, regime_tag, correlation, sample_size, computed_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [a, b, "all", correlation, shared.length, Date.now()],
      })

      entries.push(entry)
    }
  }

  return entries
}

async function getDailyPnl(strategyId: string): Promise<{ date: string; pnl: number }[]> {
  const result = await db.execute({
    sql: `SELECT DATE(t.closed_at / 1000, 'unixepoch') as date, SUM(t.pnl) as pnl
          FROM trades t
          JOIN signals s ON t.signal_id = s.id
          WHERE s.strategy_id = ? AND t.pnl IS NOT NULL AND t.closed_at IS NOT NULL
          GROUP BY DATE(t.closed_at / 1000, 'unixepoch')
          ORDER BY date`,
    args: [strategyId],
  })
  return result.rows.map(r => ({ date: r.date as string, pnl: r.pnl as number }))
}

export async function getCorrelationMatrix(): Promise<CorrelationEntry[]> {
  const result = await db.execute(
    `SELECT strategy_a, strategy_b, regime_tag, correlation, sample_size
     FROM correlation_matrix ORDER BY ABS(correlation) DESC`
  )
  return result.rows.map(r => ({
    strategyA: r.strategy_a as string,
    strategyB: r.strategy_b as string,
    regimeTag: r.regime_tag as string,
    correlation: r.correlation as number,
    sampleSize: r.sample_size as number,
  }))
}
