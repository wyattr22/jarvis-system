import Groq from "groq-sdk"
import { safeFetch } from "@/lib/sandbox/whitelist"
import { db } from "@/lib/db/client"
import { getAccount, getPositions, getBars, getLatestQuote, getBTCPrice, getVIX, getSectorETFs } from "@/lib/data/alpaca"
import { computeFeatures } from "@/lib/features/engineer"
import { analyzeSMC } from "@/lib/market/smc"
import { getRelevantMemories } from "@/lib/memory/store"
import { extractAndSaveMemories, formatMemoriesForContext } from "@/lib/memory/extract"
import { getIntermarketSnapshot, formatIntermarketForContext } from "@/lib/data/intermarket"
import { getMultiSentiment, formatSentimentForContext, type TickerSentiment } from "@/lib/data/sentiment"
import {
  getVIXGated, getBTCGated, getIntermarketGated, getEconomicsGated,
  getAccountGated, getPositionsGated, getSentimentGated, getOptionsGated,
} from "@/lib/data/gated"
import { getTodaysEconomicEvents, formatEconomicsForContext } from "@/lib/data/economics"
import { hasRecentInsiderActivity } from "@/lib/data/insider"
import { getOptionsSnapshot, formatOptionsForContext } from "@/lib/data/options"
import { COMPACT_KNOWLEDGE } from "@/lib/knowledge"
import { saveKnowledgeEntry, getDynamicKnowledge } from "@/lib/knowledge/dynamic"
import { saveMemory } from "@/lib/memory/store"
import { ingestResearch, searchResearch } from "@/lib/research/store"
import { recordTurn, checkAndApplyCorrection } from "@/lib/learning/corrections"
import { maybeSetupStats } from "@/lib/learning/setup-stats"
import { getOpportunitiesContextLine } from "@/lib/learning/opportunities-summary"

// Lazy init: the SDK throws at construction when the key is absent, which
// crashed `next build` page-data collection in keyless environments (11.12).
let _groq: Groq | null = null
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  return _groq
}

// ── Ticker detection ──────────────────────────────────────────
const KNOWN_TICKERS = new Set([
  'AAPL','MSFT','NVDA','GOOGL','GOOG','META','AMZN','TSLA','NFLX','AMD',
  'INTC','QCOM','AVGO','TXN','MU','AMAT','LRCX','KLAC',
  'JPM','BAC','GS','MS','WFC','C','V','MA','PYPL','SQ','HOOD',
  'XOM','CVX','COP','OXY','SLB','HAL',
  'JNJ','PFE','ABBV','LLY','MRK','UNH','MRNA','AMGN','GILD',
  'WMT','COST','TGT','HD','LOW','NKE','SBUX','MCD',
  'SPY','QQQ','IWM','DIA','GLD','SLV','TLT',
  'RIOT','MARA','HUT','CLSK','COIN','MSTR',
  'IONQ','SNAP','RCAT','ALAB','AAOI','CRDO',
  'LMT','RTX','NOC','BA','GD',
])

// Common English words that overlap with ticker symbols — never match these from lowercase
const TICKER_WORD_BLOCKLIST = new Set(['LOW', 'COST', 'ALL', 'ARE', 'HAS', 'HAD', 'FOR', 'THE', 'AND', 'NOT', 'WAS'])

function extractTickers(query: string, extraHistory?: string): string[] {
  const found = new Set<string>()
  const sources = [query, extraHistory ?? '']

  for (const src of sources) {
    if (!src) continue
    // $TSLA, TSLA, or tsla — case-insensitive, 2-5 letters; 2-letter only if prefixed with $
    for (const m of src.matchAll(/\$([A-Za-z]{2,5})\b/g)) {
      const t = m[1].toUpperCase()
      if (KNOWN_TICKERS.has(t)) found.add(t)
    }
    for (const m of src.matchAll(/\b([A-Za-z]{3,5})\b/g)) {
      const t = m[1].toUpperCase()
      if (KNOWN_TICKERS.has(t) && !TICKER_WORD_BLOCKLIST.has(t)) found.add(t)
    }
  }

  // Full-name aliases (spoken language: "tesla", "apple", etc.)
  const ALIASES: Record<string, string> = {
    tesla: 'TSLA', apple: 'AAPL', nvidia: 'NVDA', microsoft: 'MSFT',
    google: 'GOOGL', amazon: 'AMZN', meta: 'META', netflix: 'NFLX',
    intel: 'INTC', riot: 'RIOT', mara: 'MARA',
    coinbase: 'COIN', robinhood: 'HOOD', snapchat: 'SNAP',
  }
  const lower = (query + ' ' + (extraHistory ?? '')).toLowerCase()
  for (const [alias, ticker] of Object.entries(ALIASES)) {
    if (lower.includes(alias)) found.add(ticker)
  }
  return [...found].slice(0, 4)
}

// ── Market summary for a single ticker (with full SMC) ───────
async function getMarketSummary(symbol: string): Promise<string> {
  try {
    const [bars, quote] = await Promise.all([
      getBars(symbol, '15Min', 150, 30),
      getLatestQuote(symbol).catch(() => null),
    ])

    if (bars.length < 15) return `${symbol}: insufficient data`

    const last = bars[bars.length - 1]
    // Use bar close as primary — IEX latestTrade.p can reflect a stale trade from hours ago
    const price = last.c

    // Sanity check: if quote exists and disagrees with bar close by >40%, IEX bar data is bad
    if (quote && quote.mid > 0) {
      const drift = Math.abs(price - quote.mid) / quote.mid
      if (drift > 0.40) {
        return `${symbol}: price data inconsistency (bar=$${price.toFixed(2)} quote=$${quote.mid.toFixed(2)}) — IEX feed may have stale bars. Use TradingView chart as reference.`
      }
    }

    const fs = computeFeatures(symbol, bars)
    const smc = analyzeSMC(bars, symbol)

    // Day change: compare to first bar of today's session
    const todayDate = new Date().toISOString().slice(0, 10)
    const todayBars = bars.filter(b => b.t.startsWith(todayDate))
    const dayOpen = todayBars.length ? todayBars[0].o : bars[0].o
    const dayChange = (price - dayOpen) / dayOpen * 100

    // Session range
    const session = bars.slice(-26)
    const sessionHigh = Math.max(...session.map(b => b.h))
    const sessionLow = Math.min(...session.map(b => b.l))

    const f = fs?.features ?? {}

    const trend = (f.adx_14 ?? 0) > 25
      ? (f.ema_cross > 0 ? 'strong uptrend' : 'strong downtrend')
      : (f.adx_14 ?? 0) > 15
      ? (f.ema_cross > 0 ? 'weak uptrend' : 'weak downtrend')
      : 'ranging'

    const rsiVal = f.rsi_14 ?? 50
    const rsiStr = rsiVal > 70 ? `overbought (${rsiVal.toFixed(0)})` : rsiVal < 30 ? `oversold (${rsiVal.toFixed(0)})` : rsiVal.toFixed(0)
    const vwapStr = (f.vwap_dist ?? 0) > 0.5 ? 'above VWAP' : (f.vwap_dist ?? 0) < -0.5 ? 'below VWAP' : 'near VWAP'
    const rvolStr = (f.rel_volume ?? 1) > 2 ? `elevated (${(f.rel_volume ?? 1).toFixed(1)}x)` : (f.rel_volume ?? 1) < 0.5 ? 'low' : 'normal'
    const kzStr = f.in_kill_zone ? ' — IN KILL ZONE' : ''
    const macdStr = (f.macd_hist ?? 0) > 0 ? 'positive (bullish momentum)' : 'negative (bearish momentum)'

    const lines = [
      `[${symbol}]`,
      `PRICE: ${price.toFixed(2)} (${dayChange > 0 ? '+' : ''}${dayChange.toFixed(2)}% today)`,
      `TECHNICALS: ${trend}, RSI ${rsiStr}, ${vwapStr}, volume ${rvolStr}, MACD ${macdStr}${kzStr}`,
      `SESSION RANGE: ${sessionLow.toFixed(2)} – ${sessionHigh.toFixed(2)}`,
      `PRIOR DAY RANGE/ATR: ${(f.prior_day_range_atr_ratio ?? 0).toFixed(2)}x (>1.5 = volatile session)`,
      '',
      'SMC / ICT ANALYSIS:',
      smc.summary,
    ]

    // Multi-timeframe bias
    const [bars4h, barsDaily] = await Promise.all([
      getBars(symbol, '4Hour', 60, 30).catch(() => []),
      getBars(symbol, '1Day', 30, 60).catch(() => []),
    ])
    let htfBias = ''
    if (bars4h.length >= 10) {
      const smc4h = analyzeSMC(bars4h, symbol)
      htfBias += `4H: ${smc4h.biasDirection}`
      if (smc4h.fvgsAbove.length || smc4h.fvgsBelow.length) {
        htfBias += ` (${smc4h.fvgsAbove.length} FVG above, ${smc4h.fvgsBelow.length} below)`
      }
    }
    if (barsDaily.length >= 5) {
      const smcD = analyzeSMC(barsDaily, symbol)
      if (htfBias) htfBias += ' | '
      htfBias += `Daily: ${smcD.biasDirection}`
    }
    if (htfBias) lines.push(`HTF BIAS: ${htfBias}`)

    const insiderActivity = await hasRecentInsiderActivity(symbol).catch(() => '')
    if (insiderActivity) lines.push(`INSIDER: ${insiderActivity}`)

    return lines.join('\n')
  } catch (e) {
    return `${symbol}: error — ${String(e)}`
  }
}

// ── System context ────────────────────────────────────────────
// All external feeds pass through gated wrappers (src/lib/data/gated.ts).
// Data is only injected into context when confidence ≥ MODEL_THRESHOLD.
const MODEL_THRESHOLD = 0.5

async function buildContext(tickers: string[]): Promise<string> {
  const parts: string[] = []
  const stripped: string[] = []  // sources blocked by the quality gate

  // Macro data — run in parallel; each result includes a confidence score
  const [vixR, btcR, intermarketR, economicsR] = await Promise.all([
    getVIXGated(),
    getBTCGated(),
    getIntermarketGated(),
    getEconomicsGated(),
  ])
  // Sectors stays on raw fetch — multi-symbol aggregation, less safety-critical
  const sectors = await getSectorETFs().catch(() => ({} as Record<string, number>))

  if (vixR.confidence >= MODEL_THRESHOLD && vixR.data !== null) {
    const vix = vixR.data
    const vixZone = vix < 15 ? 'very low/complacent' : vix < 20 ? 'low/calm' : vix < 25 ? 'moderate' : vix < 30 ? 'elevated' : 'extreme fear'
    parts.push(`VIX: ${vix.toFixed(1)} (${vixZone})`)
  } else if (vixR.ok === false) stripped.push('yahoo.vix')

  if (btcR.confidence >= MODEL_THRESHOLD && btcR.data) {
    const btc = btcR.data
    parts.push(`BTC: $${btc.price.toFixed(0)} (${btc.change24h > 0 ? '+' : ''}${btc.change24h.toFixed(2)}% 24h) — relevant for RIOT/MARA/HUT`)
  } else if (btcR.ok === false) stripped.push('alpaca.btc')

  if (Object.keys(sectors).length) {
    const sectorStr = Object.entries(sectors)
      .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v.toFixed(1)}%`)
      .join(', ')
    parts.push(`SECTORS: ${sectorStr}`)
  }

  if (intermarketR.confidence >= MODEL_THRESHOLD && intermarketR.data) {
    const imStr = formatIntermarketForContext(intermarketR.data)
    if (imStr) parts.push(`INTERMARKET: ${imStr}`)
  } else if (intermarketR.ok === false) stripped.push('yahoo.intermarket')

  if (economicsR.confidence >= MODEL_THRESHOLD && economicsR.data) {
    const ecoStr = formatEconomicsForContext(economicsR.data)
    if (ecoStr) parts.push(ecoStr)
  }

  // Account + positions
  const [accountR, positionsR] = await Promise.all([getAccountGated(), getPositionsGated()])
  if (accountR.confidence >= MODEL_THRESHOLD && accountR.data) {
    const account = accountR.data
    parts.push(`ACCOUNT: equity=$${Number(account.equity).toFixed(2)}, buying_power=$${Number(account.buying_power).toFixed(2)}, day_pnl=$${Number(account.equity - account.last_equity).toFixed(2)}`)
  } else {
    parts.push('ACCOUNT: unavailable')
    if (accountR.ok === false) stripped.push('alpaca.account')
  }
  if (positionsR.confidence >= MODEL_THRESHOLD && Array.isArray(positionsR.data)) {
    const positions = positionsR.data
    if (positions.length) {
      const pos = positions.map((p: { symbol: string; qty: number; unrealized_pl: number }) =>
        `${p.symbol} qty=${p.qty} pnl=$${Number(p.unrealized_pl).toFixed(2)}`
      ).join(', ')
      parts.push(`OPEN POSITIONS: ${pos}`)
    } else {
      parts.push('OPEN POSITIONS: none')
    }
  } else if (positionsR.ok === false) stripped.push('alpaca.positions')

  // Always include broad market baseline (SPY + QQQ), plus any mentioned tickers
  const baselineTickers = ['SPY', 'QQQ']
  const allTickers = [...new Set([...baselineTickers, ...tickers])].slice(0, 5)
  const summaries = await Promise.all(allTickers.map(getMarketSummary))
  parts.push(`\nLIVE MARKET DATA:\n${summaries.join('\n\n')}`)

  if (tickers.length > 0) {
    const sentResults = await Promise.all(tickers.map(getSentimentGated))
    const goodSent = sentResults
      .map(r => r.confidence >= MODEL_THRESHOLD ? r.data : null)
      .filter((s): s is TickerSentiment => s !== null)
    const sentStr = formatSentimentForContext(goodSent)
    if (sentStr) parts.push(`STOCKTWITS SENTIMENT: ${sentStr}`)
    const blockedSent = sentResults.filter(r => r.ok === false).length
    if (blockedSent > 0) stripped.push(`stocktwits.sentiment(${blockedSent})`)

    const optResults = await Promise.all(tickers.slice(0, 2).map(getOptionsGated))
    optResults.forEach((r, i) => {
      if (r.confidence >= MODEL_THRESHOLD && r.data) {
        parts.push(formatOptionsForContext(tickers[i], r.data))
      } else if (r.ok === false) stripped.push(`yahoo.options(${tickers[i]})`)
    })
  }

  if (stripped.length > 0) {
    parts.push(`[SOURCE GATE] stripped from model input: ${stripped.join(', ')}`)
  }

  // Active strategies
  try {
    const strats = await db.execute("SELECT name, enabled, capital_tier FROM strategies LIMIT 10")
    const stratStr = strats.rows.map(s =>
      `${s.name}(${s.enabled ? 'active' : 'paused'}, tier=${s.capital_tier})`
    ).join(', ')
    if (stratStr) parts.push(`STRATEGIES: ${stratStr}`)
  } catch { /* ignore */ }

  // Dynamic knowledge entries (user-recorded via voice)
  const dynKnowledge = await getDynamicKnowledge().catch(() => "")
  if (dynKnowledge) parts.push(dynKnowledge)

  // Watchlist
  try {
    const wl = await db.execute({
      sql: "SELECT instrument, reason, lift FROM watchlist ORDER BY created_at DESC LIMIT 6",
      args: [],
    })
    if (wl.rows.length) {
      const wlStr = wl.rows.map(w => `${w.instrument}(lift=${Number(w.lift ?? 0).toFixed(2)})`).join(', ')
      parts.push(`WATCHLIST: ${wlStr}`)
    }
  } catch { /* ignore */ }

  // Recent trades
  try {
    const trades = await db.execute({
      sql: "SELECT r_multiple FROM trades WHERE r_multiple IS NOT NULL ORDER BY opened_at DESC LIMIT 10",
      args: [],
    })
    if (trades.rows.length) {
      const rs = trades.rows.map(t => Number(t.r_multiple))
      const wins = rs.filter(r => r > 0).length
      const avg = rs.reduce((a, b) => a + b, 0) / rs.length
      parts.push(`RECENT TRADES: ${wins}W/${rs.length - wins}L, avg_R=${avg.toFixed(2)}`)
    }
  } catch { /* ignore */ }

  return parts.join('\n')
}

// ── Action detection (voice site control) ────────────────────
type ZoneLevel = { price: number; label: string; color: string }
type PriceRange = { min: number; max: number }

type VoiceAction =
  | { type: 'loadChart'; symbol: string; timeframe?: string }
  | { type: 'navigate'; path: string }
  | { type: 'searchNews'; query: string }
  | { type: 'drawZone'; symbol: string; zoneType: 'fvg' | 'ob' | 'ote' | 'bsl' | 'ssl' | 'all'; levels?: ZoneLevel[]; priceRange?: PriceRange }
  | { type: 'setAlert'; symbol: string; price: number; condition: 'above' | 'below' }
  | { type: 'backtest'; strategyId: string }

type TradeOrder = { side: 'buy' | 'sell'; qty: number; symbol: string }

const PAGE_MAP: Record<string, string> = {
  portfolio: '/portfolio', positions: '/portfolio', account: '/portfolio',
  news: '/news',
  watchlist: '/watchlist', watch: '/watchlist',
  backtest: '/backtest', backtests: '/backtest',
  strategies: '/strategies', strategy: '/strategies',
  council: '/council',
  drift: '/drift',
  charts: '/charts', chart: '/charts',
  memories: '/memories', memory: '/memories',
  audit: '/agent-log', log: '/agent-log', 'agent log': '/agent-log',
  proposals: '/proposals', proposal: '/proposals',
  experiments: '/experiments', experiment: '/experiments',
  features: '/features', feature: '/features',
  bot: '/bot', bots: '/bot', 'trading bot': '/bot',
  meta: '/meta-decisions', 'meta agent': '/meta-decisions', 'meta decisions': '/meta-decisions',
  opportunities: '/opportunities', opportunity: '/opportunities', 'opp feed': '/opportunities',
  allocator: '/allocator', allocate: '/allocator', allocation: '/allocator', 'risk plan': '/allocator',
  sources: '/source-quality', 'source quality': '/source-quality', 'quality gate': '/source-quality',
}

// TF values must match the label field in charts/page.tsx TIMEFRAMES array
// Include plural/spaced forms since speech recognition produces natural language
const TF_MAP: Record<string, string> = {
  '1m': '1m', '1min': '1m', '1 min': '1m', 'one minute': '1m', '1 minute': '1m', '1 minutes': '1m',
  '5m': '5m', '5min': '5m', '5 min': '5m', 'five minute': '5m', '5 minute': '5m', 'five minutes': '5m', '5 minutes': '5m',
  '15m': '15m', '15min': '15m', '15 min': '15m', 'fifteen minute': '15m', '15 minute': '15m', 'fifteen minutes': '15m', '15 minutes': '15m',
  '30m': '30m', '30min': '30m', '30 min': '30m', 'thirty minute': '30m', '30 minute': '30m', 'thirty minutes': '30m', '30 minutes': '30m',
  '1h': '1h', '1hour': '1h', '1 hour': '1h', 'hourly': '1h', 'one hour': '1h', '60 minute': '1h', '60 minutes': '1h',
  'daily': '1D', '1d': '1D', 'day': '1D', 'one day': '1D',
}

// ── Knowledge/memory intent detection ────────────────────────
const KB_PATTERN = /\b(add|save|put|log|record|store)\b.{0,30}\b(knowledge base|kb|rules|rule book|rulebook)\b/i
const MEM_PATTERN = /\b(remember (this|that)|save (this|that) to memory|log (this|that)|don't forget (this|that))\b/i

function extractInlineContent(query: string): string | null {
  // "add to knowledge base: CONTENT" — grab everything after the colon
  const colonMatch = query.match(/(?:knowledge base|kb)\s*[:\-–]\s*(.+)/i)
  if (colonMatch) return colonMatch[1].trim()
  return null
}

function detectAction(query: string, chartSymbol?: string): VoiceAction | null {
  const lower = query.toLowerCase()
  // Tickers spoken in THIS query only — the request-level tickers[] has chartSymbol
  // prepended and includes conversation history, which made Jarvis reload the
  // current chart (or act on the wrong symbol) instead of the one just asked for
  const spoken = extractTickers(query)
  const chartUpper = chartSymbol?.toUpperCase()
  const target = spoken.find(t => t !== chartUpper) ?? spoken[0]

  // Backtest: "backtest SPY", "run backtest on smc"
  if (/\b(backtest|back test|back-test)\b/.test(lower)) {
    return { type: 'backtest', strategyId: 'smc-ict-v4' }
  }

  // Set alert: "alert me when TSLA hits 250", "set alert NVDA above 900"
  const alertMatch = lower.match(/\b(alert|notify)\b.*?\b(above|below|at|hits?|reaches?)\b.*?(\d+(?:\.\d+)?)/)
  const alertSym = target ?? chartUpper
  if (alertMatch && alertSym) {
    const price = parseFloat(alertMatch[3])
    const condition = alertMatch[2].startsWith('above') || alertMatch[2].startsWith('hit') || alertMatch[2].startsWith('reach') ? 'above' : 'below'
    if (!isNaN(price)) return { type: 'setAlert', symbol: alertSym, price, condition }
  }

  // Draw zone on chart: "mark the FVG", "draw order block", "put the zones on", "highlight OTE"
  // Falls back to the currently viewed chart symbol if no ticker is spoken
  const drawMatch = lower.match(/\b(mark|draw|highlight|show|add|plot|put|place|overlay)\b.*(fvg|fair value gap|order block|ote|buy.?side|sell.?side|bsl|ssl|gap|zones?|levels?|smc)/)
  const drawSymbol = target ?? chartUpper
  if (drawMatch && drawSymbol) {
    const hasFVG = lower.includes('fvg') || lower.includes('fair value gap') || lower.includes('gap')
    const hasOB  = lower.includes('order block') || lower.includes(' ob ')
    const hasOTE = lower.includes('ote')
    const hasBSL = lower.includes('bsl') || lower.includes('buy side') || lower.includes('buy-side')
    const hasSSL = lower.includes('ssl') || lower.includes('sell side') || lower.includes('sell-side')
    const hasAll = lower.includes('zones') || lower.includes('levels') || lower.includes('smc') || lower.includes('all')

    // Multiple types mentioned or "all zones/levels/smc" → draw everything
    const typesCount = [hasFVG, hasOB, hasOTE, hasBSL, hasSSL].filter(Boolean).length
    if (hasAll || typesCount > 1) return { type: 'drawZone', symbol: drawSymbol, zoneType: 'all' }
    if (hasFVG) return { type: 'drawZone', symbol: drawSymbol, zoneType: 'fvg' }
    if (hasOB)  return { type: 'drawZone', symbol: drawSymbol, zoneType: 'ob' }
    if (hasOTE) return { type: 'drawZone', symbol: drawSymbol, zoneType: 'ote' }
    if (hasBSL) return { type: 'drawZone', symbol: drawSymbol, zoneType: 'bsl' }
    if (hasSSL) return { type: 'drawZone', symbol: drawSymbol, zoneType: 'ssl' }
    // Vague "draw the zones" → all
    return { type: 'drawZone', symbol: drawSymbol, zoneType: 'all' }
  }

  // News search: "search news for Tesla", "find news on NVDA"
  const newsSearch = lower.match(/\b(search|find|look up|show).*(news|article|headline).*?(for|on|about)\b/)
  const newsSym = target ?? chartUpper
  if (newsSearch && newsSym) {
    return { type: 'searchNews', query: newsSym }
  }

  // Chart load: "show me TSLA", "pull up NVDA on 5 minute", "open NVTS" (any ticker, not just watchlist)
  const chartIntent = /\b(show|pull up|open|load|chart|look at|check|bring up|display|view|switch to|go to|jump to)\b/.test(lower)
  if (chartIntent) {
    let timeframe: string | undefined
    for (const [key, val] of Object.entries(TF_MAP)) {
      if (lower.includes(key)) { timeframe = val; break }
    }

    if (target) {
      return { type: 'loadChart', symbol: target, timeframe }
    }

    // Broader: catch any symbol not in KNOWN_TICKERS
    const CHART_STOP = new Set([
      'SHOW','PULL','OPEN','LOAD','CHART','CHARTS','LOOK','CHECK','BRING','VIEW',
      'SWITCH','JUMP','DISPLAY','GO','TO','UP','ME','THE','AND','ON','AT','FOR',
      'IN','MY','IT','A','AN','BY','OF','OR','DO','LET',
      // Page names — navigation requests, not ticker symbols
      'NEWS','WATCH','MEMORY','AUDIT','LOG','BOT','BOTS','META','PAGE','TAB','TABS',
    ])
    // Text input — user typed uppercase ticker (e.g. "show me NVTS")
    for (const m of query.matchAll(/\b([A-Z]{2,6})\b/g)) {
      if (!CHART_STOP.has(m[1])) return { type: 'loadChart', symbol: m[1], timeframe }
    }
    // Voice input — word immediately after intent phrase (e.g. "pull up nvts", "open the nvts chart")
    const wordAfter = lower.match(/\b(?:pull up|show me|open|load|bring up|check|view)\s+(?:the\s+)?([a-z]{2,6})\b/)
    if (wordAfter) {
      const candidate = wordAfter[1].toUpperCase()
      if (!CHART_STOP.has(candidate)) return { type: 'loadChart', symbol: candidate, timeframe }
    }

    // No ticker found — a page name spoken with a chart verb is navigation
    // ("open news", "go to portfolio"). Previously the chart branch swallowed
    // these and reloaded the current chart.
    for (const [key, path] of Object.entries(PAGE_MAP)) {
      if (lower.includes(key)) return { type: 'navigate', path }
    }

    // Timeframe-only change ("switch to the 5 minute") — same chart, new interval
    if (timeframe && chartUpper) {
      return { type: 'loadChart', symbol: chartUpper, timeframe }
    }
    // Fall through to nav detection if nothing matched
  }

  // Page navigation: "go to portfolio", "open news", "show me the watchlist"
  const navIntent = /\b(go to|open|show me|take me to|navigate|switch to|jump to|head to)\b/.test(lower)
  if (navIntent) {
    for (const [key, path] of Object.entries(PAGE_MAP)) {
      if (lower.includes(key)) return { type: 'navigate', path }
    }
  }

  return null
}

// ── Auto-extract trading knowledge from attached files ────────
async function extractFileKnowledge(content: string, fileName: string, tickers: string[]): Promise<void> {
  const baseName = fileName?.replace(/\.[^.]+$/, '') ?? 'research'
  const category = tickers.length ? tickers[0].toLowerCase() : baseName.toLowerCase().slice(0, 20)

  const prompt = `You are building a permanent trading knowledge base entry from this research document.
Extract and document EVERYTHING that could inform future trading decisions. Be exhaustive — do not summarise, do not truncate, do not skip anything:

- Every setup criteria and market condition
- Every entry rule with exact specifications (prices, percentages, bar counts)
- Every exit rule: stop method, take profit logic, trailing stops
- Every risk management rule: position sizing, max loss per trade, max daily loss
- Every statistical finding: win rate, R-multiple distribution, drawdown, sample size, edge ratio
- Every market regime filter: trending vs ranging, volatility threshold, session, time of day
- Every edge condition: what makes the setup work, what invalidates it
- Every exception, caveat, or context-dependent rule

Preserve exact numbers. This is Jarvis's permanent memory of this document — completeness matters more than brevity.

Document (${fileName}):
${content.slice(0, 14000)}`

  try {
    // 1. Chunk the full raw text into the research store — enables accurate retrieval later
    await ingestResearch(baseName, content.slice(0, 60000)).catch(() => {})

    // 2. LLM generates a compact knowledge summary for the always-in-context knowledge base
    const res = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    })
    const knowledge = res.choices[0]?.message?.content ?? ''
    if (knowledge.length < 50) return

    // Save compact summary to knowledge base (always in context, capped size)
    await saveKnowledgeEntry(
      `SOURCE DOCUMENT: "${fileName}"\nCATEGORY: ${category}\n\n${knowledge}`,
      category
    )

    // Save to memory store for relevance-based retrieval
    await saveMemory(
      `I was taught the contents of "${fileName}":\n${knowledge}`,
      'insight',
      { tags: tickers, importance: 9, source: 'system' }
    ).catch(() => {})
  } catch { /* silent — non-critical */ }
}

// ── Trade intent detection ────────────────────────────────────
function detectTradeIntent(query: string, chartSymbol?: string): TradeOrder | null {
  const lower = query.toLowerCase()

  // Close all positions
  if (/\b(close|exit|flatten|dump)\b.*(all|everything|all\s+positions?)\b/.test(lower) ||
      /\bclose\s+all\b/.test(lower)) {
    return { side: 'sell', qty: 0, symbol: 'ALL' }
  }

  // Ticker spoken in THIS query takes priority — the request-level tickers[] has
  // chartSymbol prepended, which could route an order to the wrong symbol
  const chartUpper = chartSymbol?.toUpperCase()
  const spoken = extractTickers(query)
  const sym = (spoken.find(t => t !== chartUpper) ?? spoken[0]) ?? chartUpper

  // Parse first number in the query as quantity
  const qtyMatch = lower.match(/\b(\d+)\b/)
  const qty = qtyMatch ? parseInt(qtyMatch[1]) : 0

  // Buy intent
  if (/\b(buy|purchase|go long|get long)\b/.test(lower) && sym && qty > 0) {
    return { side: 'buy', qty, symbol: sym }
  }

  // Sell/short intent with quantity
  if (/\b(sell|short|go short)\b/.test(lower) && sym && qty > 0) {
    return { side: 'sell', qty, symbol: sym }
  }

  // Close specific position (no qty needed — backend closes full position)
  if (/\b(close|exit|flatten)\b/.test(lower) && sym) {
    return { side: 'sell', qty: 0, symbol: sym }
  }

  return null
}

// ── 60-second market context cache (keyed on tickers) ────────
type CtxCache = { context: string; builtAt: number; tickerKey: string }
let _ctxCache: CtxCache | null = null

async function buildContextCached(tickers: string[]): Promise<string> {
  const tickerKey = [...tickers].sort().join(',')
  const now = Date.now()
  if (_ctxCache && _ctxCache.tickerKey === tickerKey && now - _ctxCache.builtAt < 60_000) {
    return _ctxCache.context
  }
  const context = await buildContext(tickers)
  _ctxCache = { context, builtAt: now, tickerKey }
  return context
}

// ── Casual detection ──────────────────────────────────────────
function isCasual(q: string): boolean {
  const lower = q.toLowerCase().trim()
  if (lower.split(/\s+/).length > 4) return false
  return /^(thanks|thank you|thx|ty|cheers|appreciate|good job|perfect|got it|makes sense|sounds good|understood|no worries|no problem|hey|hi|hello|how are you|you good)[\s!.?]*$/.test(lower)
}

// Nav/UI commands — full market data is wasteful here, use lightweight context
function isNavOnly(q: string): boolean {
  const lower = q.toLowerCase().trim()
  // Pure navigation, page switches, and simple site control with no market question attached
  return /^(go to|open|show me|take me to|navigate to|switch to|jump to|head to)\s+(portfolio|news|watchlist|charts|backtest|strategies|council|drift|memories|audit|proposals|experiments|features|bot|meta)[\s!.?]*$/.test(lower)
}

// ── Handler ───────────────────────────────────────────────────
export async function POST(req: Request) {
  const { query, history, chartSymbol, fileContent, fileName } = await req.json()
  if (!query || typeof query !== 'string') {
    return Response.json({ error: 'query required' }, { status: 400 })
  }

  const casual = isCasual(query)
  const navOnly = !casual && isNavOnly(query)
  // Include last 3 user turns in ticker search so follow-up queries ("why not") retain context
  const recentHistory = Array.isArray(history)
    ? (history as { role: string; content: string }[]).slice(-6).filter(h => h.role === 'user').map(h => h.content).join(' ')
    : ''
  const extractedTickers = (casual || navOnly) ? [] : extractTickers(query, recentHistory)
  // Always include the currently viewed chart symbol so "what's happening?" works without naming the ticker
  const tickers = (casual || navOnly) ? [] : (
    chartSymbol && !extractedTickers.includes(chartSymbol.toUpperCase())
      ? [chartSymbol.toUpperCase(), ...extractedTickers]
      : extractedTickers
  )
  const tradeOrder = (casual || navOnly) ? null : detectTradeIntent(query, chartSymbol)

  // Correction check — runs in parallel with everything else; if the user said
  // "no that's wrong", demote the cited memories from the prior turn
  const correctionPromise = (casual || navOnly)
    ? Promise.resolve({ applied: false, memoriesDemoted: 0 })
    : checkAndApplyCorrection(query, tickers).catch(() => ({ applied: false, memoriesDemoted: 0 }))

  // Hard 12-second deadline on context — if any API hangs, we still respond
  const contextTimeout = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), 12000))])

  const [context, memories, research, setupStats, oppsLine] = await Promise.all([
    (casual || navOnly) ? Promise.resolve(null) : contextTimeout(buildContextCached(tickers), ''),
    navOnly ? Promise.resolve([]) : contextTimeout(getRelevantMemories(tickers, query).catch(() => []), []),
    (casual || navOnly) ? Promise.resolve('') : contextTimeout(searchResearch(query).catch(() => ''), ''),
    (casual || navOnly) ? Promise.resolve('') : maybeSetupStats(query).catch(() => ''),
    (casual || navOnly) ? Promise.resolve('') : getOpportunitiesContextLine().catch(() => ''),
  ])
  const memoryBlock = await formatMemoriesForContext(memories)

  const systemPrompt = casual
    ? `You are Jarvis, a sharp and witty British AI assistant — think a more personable Alfred meets a trading desk veteran. Respond naturally and briefly. Dry wit is encouraged. No filler.`
    : `You are Jarvis, a sharp British AI trading assistant embedded in a self-optimizing multi-agent trading system called Jarvis v2. You have access to live market data, account state, and the full system.

PERSONALITY: British, composed, and direct — dry wit when the moment calls for it. You say "quite", "rather", "brilliant", "indeed", "I'd wager", "spot on" naturally, not as a caricature. You're a trusted advisor, not a chatbot. Never sycophantic, never padded. If you don't know something, say so crisply.

LENGTH: One sentence for simple facts. Two to four for analysis or chart discussion. Deeper only if asked.

STYLE: Spoken language only. No markdown, no lists, no bullet points. Numbers in natural speech. No filler phrases.

CRITICAL CONSTRAINTS — NEVER violate these:
1. You CANNOT see the dashboard, charts, or UI. You have no visual access to any screen, iframe, or TradingView widget. Never claim to "see", "look at", "notice on the chart", or "observe" anything visually.
2. Every price, level, RSI, volume, or technical reading you cite MUST come from the "LIVE MARKET DATA" section in your context. If a symbol's data is not in your context, say you don't have data for it — do not invent numbers.
3. If the market is closed or data is stale, say so. Do not fabricate prices.
4. You cannot switch charts yourself — you instruct the system, you do not "look at" the result.

PERSISTENT KNOWLEDGE BASE — this is critical:
You have a USER-RECORDED KNOWLEDGE section in your context (below). This contains documents, research, and facts the user has explicitly taught you. You CAN and MUST reference this — it is your permanent memory. When the user asks "what did you learn from X" or "what do you know about Y", search this section and cite it directly. Never claim you cannot read files or have no memory of documents — if it's in USER-RECORDED KNOWLEDGE, you learned it and you own it. The knowledge base persists across all conversations.

SYSTEM KNOWLEDGE — you know this system inside out:

The dashboard has these sections:
- CHARTS: Live candlestick charts with SMC overlays (FVG, BOS, swing highs/lows, VWAP). You can discuss any ticker.
- PORTFOLIO: Live account equity, open positions, unrealized P&L, buying power from Alpaca paper trading.
- NEWS: Aggregated feed from 10+ sources (MarketWatch, CNBC, Reuters, Yahoo Finance, etc.) with earnings calendar, sector filter, and ticker search.
- WATCHLIST: Agent-curated instruments. The Observer automatically adds stocks with statistically significant patterns (lift > 1.3, p < 0.05). Users can also add manually.
- BOT: Controls the live SMC/ICT strategy bots. Can pause or activate strategies. Shows capital tier (1%, 5%, full).
- BACKTEST: Run historical simulations on strategies.
- STRATEGIES: All registered trading strategies with their status and performance.
- FEATURES: The 42 technical features computed per instrument every day (RSI, ATR, VWAP distance, FVG age, kill zone, prior day range/ATR ratio, etc.). These feed the Observer's pattern mining.
- PROPOSALS: Council-generated proposals to change strategy parameters. Each goes through shadow testing before being promoted.
- EXPERIMENTS: Active A/B shadow tests. A proposed change runs alongside the original to accumulate statistical evidence before being adopted.
- COUNCIL: The multi-agent council that runs every Sunday. Four agents analyze performance and submit proposals: Observer (ML pattern mining), Researcher (hypothesis generation), Critic A/B/C (three different LLM families review proposals), Meta-Agent (evaluates the agents themselves). Proposals require 2-of-3 critic approval to advance.
- META: Meta-agent decisions — scoring agents on accuracy, detecting reward-hacking, adjusting prompt versions.
- AUDIT LOG: Complete log of all agent actions, council cycles, and system events.

The trading edge is currently the SMC/ICT strategy on Alpaca paper trading. The council's job is to improve it — discovering filters, parameter changes, and new features. No live capital touches council outputs until 60+ days of paper performance with statistical significance.

TRADING KNOWLEDGE — strategy frameworks you understand and reference fluently:
${COMPACT_KNOWLEDGE}

When discussing charts or price action, use the actual SMC/ICT data — cite the specific FVG levels, order block zones, OTE range, swing highs/lows, equal highs (buy-side liquidity), equal lows (sell-side liquidity), pre-market gap. Speak in specific prices. That's what makes you useful.

For "where are the gaps", "next target", "where will price react", "good entry?" — answer directly from the SMC analysis. Don't hedge. Give levels and a brief read. When discussing the council or system, explain it like you own it.

Current system state:
${context}
${chartSymbol ? `\nUSER IS CURRENTLY VIEWING: ${chartSymbol} chart` : ''}
${fileContent ? `\n\nFILE CONTEXT — ${fileName ?? 'attachment'}:\n${(fileContent as string).slice(0, 8000)}` : ''}
${memoryBlock}
${research ? `\n${research}` : ''}
${setupStats ? `\n${setupStats}` : ''}
${oppsLine ? `\n${oppsLine}` : ''}
${tradeOrder ? `\nTRADE ORDER PENDING: The user wants to ${tradeOrder.qty === 0 ? (tradeOrder.symbol === 'ALL' ? 'close ALL positions' : `close their ${tradeOrder.symbol} position`) : `${tradeOrder.side} ${tradeOrder.qty} shares of ${tradeOrder.symbol}`}. Respond with a SINGLE spoken sentence verbally confirming the exact details and instructing them to say "confirm" to execute or "cancel" to abort. Do not execute anything yourself.` : ''}`

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
  ]

  if (Array.isArray(history)) {
    for (const turn of history.slice(-10)) {
      if (turn.role && turn.content) messages.push(turn as { role: "user" | "assistant"; content: string })
    }
  }

  messages.push({ role: "user", content: query })

  // LLM call: parallel race across all providers — fastest non-null wins
  // Each Groq model has its own rate-limit bucket, so spreading across models
  // gives ~5x the effective Groq capacity.
  async function tryLLM(): Promise<string> {
    const maxTok = casual ? 60 : 250
    const temp   = casual ? 0.8 : 0.45

    // Wraps any provider call — returns null on any error instead of throwing
    const attempt = (label: string, fn: () => Promise<string>): Promise<string | null> =>
      fn().then(r => r || null).catch(e => { console.error(`[voice] ${label}:`, String(e)); return null })

    const callCerebras = () => attempt('Cerebras', async () => {
      const r = await safeFetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.CEREBRAS_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.3-70b', max_tokens: maxTok, messages, temperature: temp }),
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const j = await r.json()
      return j.choices?.[0]?.message?.content ?? ''
    })

    const callGroq = (model: string) => attempt(`Groq/${model}`, async () => {
      const r = await getGroq().chat.completions.create({ model, max_tokens: maxTok, messages, temperature: temp,
        // @ts-expect-error — groq-sdk accepts timeout in options
        timeout: 10000 })
      return r.choices[0]?.message?.content ?? ''
    })

    const callOpenRouter = (model: string) => attempt(`OR/${model}`, async () => {
      const r = await safeFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://jarvis-system-flame.vercel.app' },
        body: JSON.stringify({ model, max_tokens: maxTok, messages, temperature: temp }),
        signal: AbortSignal.timeout(18000),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const j = await r.json()
      return j.choices?.[0]?.message?.content ?? ''
    })

    // Round 1: Cerebras (fast, separate quota) + Groq 8B (30k TPM — 5× higher limit than 70B)
    // Using 8B as primary Groq because each Jarvis request is 5k+ tokens and 70B only allows
    // 6k tokens/minute — meaning ONE message exhausts the 70B quota for a full minute.
    // 8B handles conversational and analysis queries well and rarely needs 70B quality.
    const round1 = await Promise.all([
      callCerebras(),
      callGroq('llama-3.1-8b-instant'),   // 30,000 TPM — primary workhorse
    ])
    const r1 = round1.find(r => r !== null && r.length > 0)
    if (r1) return r1

    // Round 2: Groq 70B quality upgrade + Mixtral (both separate buckets from 8B)
    const round2 = await Promise.all([
      callGroq('llama-3.3-70b-versatile'),   // 6,000 TPM — better quality, lower quota
      callGroq('mixtral-8x7b-32768'),         // separate bucket
    ])
    const r2 = round2.find(r => r !== null && r.length > 0)
    if (r2) return r2

    // Round 3: Gemma (separate Groq bucket). SambaNova removed 2026-07-05 —
    // its free tier is a one-time $5 credit, not renewable.
    const r3 = await callGroq('gemma2-9b-it')
    if (r3) return r3

    // Round 4: last resort — OpenRouter
    const r4 = await callOpenRouter(casual ? 'meta-llama/llama-3.1-8b-instruct:free' : 'meta-llama/llama-3.3-70b-instruct:free')
    if (r4) return r4

    return ''
  }

  // ── Knowledge base save ───────────────────────────────────────
  if (!casual && KB_PATTERN.test(query)) {
    const inline = extractInlineContent(query)
    const toSave = inline ?? query.replace(KB_PATTERN, "").trim()
    if (toSave.length > 5) {
      const category = tickers.length ? tickers[0].toLowerCase() : "general"
      await saveKnowledgeEntry(toSave, category).catch(() => {})
      return Response.json({
        response: `Noted — I've added that to the knowledge base${tickers.length ? ` under ${tickers[0]}` : ""}. I'll apply it going forward.`,
        tickers,
        action: null,
        saved: "knowledge",
      })
    }
  }

  // ── Force memory save ─────────────────────────────────────────
  if (!casual && MEM_PATTERN.test(query)) {
    const toSave = query.replace(MEM_PATTERN, "").trim() || query
    if (toSave.length > 5) {
      await saveMemory(toSave, "fact", {
        tags: tickers,
        importance: 9,
        source: "user_said",
      }).catch(() => {})
      return Response.json({
        response: "Remembered. I've saved that with high priority — it'll inform my responses going forward.",
        tickers,
        action: null,
        saved: "memory",
      })
    }
  }

  // Handle backtest action inline — fetch results and fold into LLM context
  // Trade intents take priority over nav/chart actions
  const action = (casual || tradeOrder) ? null : detectAction(query, chartSymbol)

  if (action?.type === 'backtest') {
    try {
      const btRes = await safeFetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://jarvis-system-flame.vercel.app'}/api/backtest?strategyId=${action.strategyId}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (btRes.ok) {
        const btData = await btRes.json()
        const trades: { r_multiple: number }[] = btData.trades ?? []
        if (trades.length > 0) {
          const wins = trades.filter(t => t.r_multiple > 0).length
          const avg = trades.reduce((s, t) => s + t.r_multiple, 0) / trades.length
          const wr = ((wins / trades.length) * 100).toFixed(0)
          messages.push({
            role: 'user',
            content: `[BACKTEST RESULTS for ${action.strategyId}]: ${trades.length} trades, ${wr}% win rate, avg R-multiple ${avg.toFixed(2)}. Summarise this for the trader in 2 sentences.`,
          })
        }
      }
    } catch { /* ignore — fall through to normal LLM response */ }
  }

  // ── drawZone: fetch SMC levels + price range for SVG overlay ─
  if (action?.type === 'drawZone') {
    try {
      const bars = await getBars(action.symbol, '15Min', 150, 30)
      const smc = analyzeSMC(bars, action.symbol)
      const levels: ZoneLevel[] = []

      const addFVG = () => {
        for (const fvg of [...smc.fvgsAbove, ...smc.fvgsBelow]) {
          const c = fvg.type === 'bullish' ? '#00d4a1' : '#ef4444'
          levels.push({ price: fvg.high, label: 'FVG', color: c })
          levels.push({ price: fvg.low,  label: '',    color: c })
        }
      }
      const addOB = () => {
        for (const ob of smc.bullishOBs) {
          levels.push({ price: ob.high, label: 'Bull OB', color: '#00d4a1' })
          levels.push({ price: ob.low,  label: '',        color: '#00d4a1' })
        }
        for (const ob of smc.bearishOBs) {
          levels.push({ price: ob.high, label: 'Bear OB', color: '#ef4444' })
          levels.push({ price: ob.low,  label: '',        color: '#ef4444' })
        }
      }
      if (action.zoneType === 'fvg' || action.zoneType === 'all') addFVG()
      if (action.zoneType === 'ob'  || action.zoneType === 'all') addOB()
      if ((action.zoneType === 'ote' || action.zoneType === 'all') && smc.oteZone) {
        const c = smc.oteZone.direction === 'bullish' ? '#3b82f6' : '#f59e0b'
        levels.push({ price: smc.oteZone.high, label: 'OTE', color: c })
        levels.push({ price: smc.oteZone.low,  label: '',    color: c })
      }
      if (action.zoneType === 'bsl' || action.zoneType === 'all') {
        for (const p of smc.equalHighs) levels.push({ price: p, label: 'BSL', color: '#f59e0b' })
      }
      if (action.zoneType === 'ssl' || action.zoneType === 'all') {
        for (const p of smc.equalLows) levels.push({ price: p, label: 'SSL', color: '#a855f7' })
      }

      if (levels.length) action.levels = levels

      // Compute visible price range from last 80 bars — used by the SVG overlay to map prices to Y positions
      const last80 = bars.slice(-80)
      if (last80.length > 0) {
        const allLows  = last80.map(b => b.l)
        const allHighs = last80.map(b => b.h)
        const rangeMin = Math.min(...allLows)
        const rangeMax = Math.max(...allHighs)
        const pad = (rangeMax - rangeMin) * 0.06
        action.priceRange = { min: rangeMin - pad, max: rangeMax + pad }
      }
    } catch { /* fall through */ }
  }

  let text = await tryLLM()
  if (!text) text = "All three providers are currently unavailable — try again in a moment."

  // Fire-and-forget memory extraction — don't await, never blocks the response
  if (!casual && text && !text.startsWith("Bear with") && !text.startsWith("Something went wrong")) {
    extractAndSaveMemories(query, text, tickers).catch(() => {})
  }

  // Record this turn so the next message can be checked for corrections
  const cited = memories.map(m => m.id)
  recordTurn(query, text, cited).catch(() => {})
  const corr = await correctionPromise
  if (corr.applied) {
    console.log(`[corrections] demoted ${corr.memoriesDemoted} memories from prior turn`)
  }

  // Auto-save knowledge from attached files — awaited so confirmation is accurate
  if (fileContent && typeof fileContent === 'string' && fileContent.length > 100) {
    await extractFileKnowledge(fileContent, fileName ?? 'attachment', tickers).catch(() => {})
  }

  return Response.json({ response: text, tickers, action, tradeOrder: tradeOrder ?? undefined })
}
