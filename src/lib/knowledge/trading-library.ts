// Full trading strategy knowledge base — 20+ frameworks for council brainstorming

export const TRADING_LIBRARY = `
=== TRADING STRATEGY LIBRARY — JARVIS KNOWLEDGE BASE ===

── 1. MEAN REVERSION ──────────────────────────────────────────────────────────
Premise: prices revert to statistical mean after extreme deviations.
Entry: RSI < 30 (oversold) or > 70 (overbought) + Bollinger Band breach + mean reversion candle
Exit: return to 20-period MA or opposite Bollinger Band
Key metrics: Z-score of price vs rolling mean, half-life of mean reversion
Edge conditions: works best in low-ADX (< 20) ranging markets
Risk: trend continuation burns mean reversion traders — use ADX filter
Example filter: only trade when price Z-score > 2.0 AND ADX < 20 AND volume < 1.5x avg
Sizing: Kelly fraction = edge / odds; typical 1-2% risk per trade

── 2. TREND FOLLOWING ─────────────────────────────────────────────────────────
Premise: trends persist longer than expected; ride the momentum.
Entry: EMA crossover (9/21 or 20/50) + ADX > 25 + price above VWAP
Exit: trailing stop (2x ATR) or opposing EMA cross
Key metrics: ADX, slope of EMA, R² of price regression
Edge conditions: works in trending regimes (ADX > 25), breaks down in chop
Risk: whipsaws in ranging markets eat into gains
SMC integration: use BOS confirmation to validate trend entry (ICT trend confirmation)
Sizing: pyramiding on open profit — add at each BOS in trend direction

── 3. BREAKOUT TRADING ────────────────────────────────────────────────────────
Premise: price compression precedes expansion; trade the expansion.
Entry: price closes outside N-period high/low + volume > 2x avg (Donchian channel breakout)
Confirmation: retest of breakout level holding as support/resistance
Exit: measured move (height of base × 1.5–2x) or next major structure level
Key metrics: ATR compression ratio (current ATR / 20-period avg ATR)
False breakout filter: require second candle close beyond level; avoid if within 30min of close
SMC note: breakout from consolidation = FVG zone likely forms above the break

── 4. VWAP STRATEGIES ────────────────────────────────────────────────────────
Premise: VWAP is the institutional fair value benchmark; deviations get faded.
VWAP Reversion: buy below VWAP when price returns to it with confluence (FVG or OB at VWAP)
VWAP Trend: use VWAP as dynamic support/resistance in strong trend days
VWAP Anchored: anchor VWAP to key swing points (earnings, major news) for custom levels
Day trading rule: above VWAP = bullish bias; below VWAP = bearish bias
VWAP standard deviation bands (±1, ±2 SD) = institutional entry/exit zones
Best on: first 90 minutes of session and last 30 minutes

── 5. MOMENTUM ────────────────────────────────────────────────────────────────
Premise: stocks moving strongly continue in that direction short-term.
Entry: relative strength vs SPY (RS ratio > 1.2) + 52-week high proximity + volume surge
Short-term: 1-5 day momentum using rate-of-change (ROC) indicator
Cross-sectional: rank universe by 12-1 month returns; long top decile
Risk: momentum crashes — drawdowns can be sharp and fast (20%+ in days)
Filters: avoid earnings weeks; use beta-adjusted sizing
SMC integration: momentum confirms ICT bias — high RS stocks with clean ICT setups

── 6. STATISTICAL ARBITRAGE / PAIRS TRADING ──────────────────────────────────
Premise: cointegrated pairs revert to historical spread relationship.
Entry: spread Z-score > 2.0 (sell expensive, buy cheap relative)
Exit: spread Z-score < 0.5 (convergence)
Pair selection: Pearson correlation > 0.85 + cointegration test (Engle-Granger p < 0.05)
Common pairs: XOM/CVX, JPM/BAC, MSFT/GOOGL, GLD/SLV
Hedge ratio: OLS regression of A vs B, use beta as hedge ratio
Risk: pairs diverge permanently (regime change) — stop at Z-score > 3.5
Execution: simultaneous entry required; slippage must be modeled carefully

── 7. KELLY CRITERION & POSITION SIZING ──────────────────────────────────────
Premise: maximize long-run compounding by sizing proportional to edge.
Full Kelly: f = (bp - q) / b where b=odds, p=win probability, q=1-p
Half Kelly: use 50% of Kelly fraction to reduce variance (recommended)
Fractional Kelly: use 25% of Kelly for strategies with < 60% confidence in edge estimate
Example: 55% win rate, 2:1 RR → Kelly = (2×0.55 - 0.45)/2 = 32.5% → Half Kelly = 16%
Current bot uses fixed 35% position size — consider Kelly adjustment based on rolling WR
Dynamic Kelly: recalculate every 50 trades using rolling win rate and avg RR

── 8. MARKET MICROSTRUCTURE ──────────────────────────────────────────────────
Premise: order flow mechanics and market maker behavior create exploitable patterns.
Bid-ask spread dynamics: wider spreads = less liquid, more slippage
Order book imbalance: large bid wall vs ask = institutional buying/selling
Time and sales: cluster of large trades at ask = institutional accumulation
Market impact: trade at 10% of avg volume to minimize price impact
Dark pool prints: significant above-ask prints = potential insider accumulation
Tape reading: speed of prints + size accelerating = momentum is genuine
Relevance: adjust position sizing based on average spread; avoid opening 5min (max spread)

── 9. ORDER FLOW / FOOTPRINT ─────────────────────────────────────────────────
Premise: volume traded at bid vs ask reveals institutional intent.
Delta = (volume at ask) - (volume at bid) → positive = buying pressure
Cumulative delta divergence: price makes new high but delta makes lower high = distribution
POC (Point of Control): price level with highest traded volume = strong support/resistance
Value Area: 70% of daily volume traded (High + Low = VA boundaries)
Imbalance clusters: 3:1 or greater ratio of buy vs sell volume at a price level
SMC connection: order block identification improves with delta confirmation at OB level
Note: requires Bookmap, Sierra Chart, or similar footprint software for full data

── 10. ELLIOTT WAVE THEORY ────────────────────────────────────────────────────
Premise: markets move in 5-wave impulse + 3-wave correction fractal patterns.
Impulse: Wave 1 (initial move), 2 (correction), 3 (largest, 1.618×W1), 4 (correction), 5 (final)
Correction: A-B-C zigzag retracing 38.2–61.8% of impulse
Wave 3 rules: cannot be shortest impulse wave; often 1.618–2.618 × Wave 1
Wave 2 rule: cannot retrace > 100% of Wave 1
Fibonacci targets: Wave 3 = 1.618×W1, Wave 5 = 1.0×W1, Correction = 38.2–61.8%
SMC integration: Elliott counts confirm ICT Premium/Discount zones
Risk: subjective interpretation; two analysts often count differently — use as bias, not entry

── 11. WYCKOFF METHOD ─────────────────────────────────────────────────────────
Premise: institutions (composite operator) accumulate before markup, distribute before markdown.
Accumulation phases: PS (preliminary support) → SC (selling climax) → AR (automatic rally) → ST (secondary test) → Spring → SOS (sign of strength) → LPS → markup
Distribution phases: BC (buying climax) → AR → ST → UTAD (upthrust after distribution) → SOW → LPSY → markdown
Key concepts: cause and effect — larger the trading range, bigger the subsequent move
Volume analysis: volume should dry up on tests and surge on breakouts
SMC connection: Wyckoff Spring = liquidity sweep of support (SSL in ICT terms)
Application: use Wyckoff to identify accumulation phase on daily; ICT for intraday entry

── 12. SEASONALITY / CALENDAR EFFECTS ────────────────────────────────────────
Well-documented patterns:
  "Sell in May": stocks underperform May–Oct vs Nov–Apr (average 4% differential)
  January Effect: small caps outperform in January (tax-loss harvesting reversal)
  Pre-holiday drift: markets drift higher 3 days before major holidays
  Monday Effect: historically weakest day (opening gaps from weekend news)
  OPEX week: options expiration weeks show pinning behavior in high-OI strikes
  Turn of month: institutional rebalancing creates buying pressure final 3/first 3 trading days
  Fed week: higher volatility around FOMC meetings (avoid or reduce size)
  Earnings season: IV expansion before earnings, IV crush after → options plays

── 13. EARNINGS PLAYS ─────────────────────────────────────────────────────────
Pre-earnings drift: stocks with positive estimate revisions drift up in the 3 weeks before
Post-earnings gap: direction depends on earnings vs whisper number (not vs consensus)
IV crush trade: sell straddle/strangle 1–2 weeks before earnings (collect premium from IV expansion)
Gap and go: stock gaps > 5% on earnings → trade the continuation intraday (first 30 min)
Gap fade: gap > 10% with no news catalyst → fade back toward VWAP
Beat and retreat: beat estimates but price falls = prior run-up priced it in
Miss and rally: miss estimates but price rises = expectations were too low
Size rule: halve position size during earnings weeks for directional plays

── 14. OPTIONS STRATEGIES ─────────────────────────────────────────────────────
Covered Call: long 100 shares + sell 1 OTM call → income strategy; cap upside at strike
Cash-Secured Put: sell OTM put → collect premium; obligated to buy at strike if assigned
Vertical Spread (Bull/Bear): buy one option + sell further OTM option → defined risk
Iron Condor: sell OTM call + sell OTM put + buy wings for protection → range-bound premium
Straddle: buy ATM call + ATM put → profit if large move in either direction
Strangle: buy OTM call + OTM put → cheaper than straddle, needs larger move
Calendar Spread: sell near-term option + buy same strike further out → time decay play
Greeks: Delta (price sensitivity), Gamma (delta sensitivity), Theta (time decay), Vega (IV sensitivity)
IV Rank: if IV rank > 50, premium selling is favored; if < 30, premium buying favored

── 15. DELTA-NEUTRAL OPTIONS ──────────────────────────────────────────────────
Premise: hedge directional exposure to profit purely from volatility changes.
Setup: sell options, hedge delta with underlying shares/futures
Gamma scalping: buy gamma (long straddle), scalp shares against moves to collect
Theta farming: sell gamma (short straddle), hedge delta frequently to collect time decay
Vega trading: long vega (buy options) when IV rank low; short vega when IV rank high
Practical note for this system: GEX (gamma exposure) data tells you whether the market is
  long gamma (pinning behavior, mean-revert intraday) or short gamma (trending, explosive)
  Negative GEX = institutions short gamma = market makers must buy dips AND sell rallies
    → amplifies directional moves (SMC setups more reliable)
  Positive GEX = long gamma = price pins near max pain
    → VWAP reversion setups more reliable than breakouts

── 16. PORTFOLIO OPTIMIZATION ─────────────────────────────────────────────────
Modern Portfolio Theory: maximize Sharpe by finding efficient frontier of asset combinations
Key metrics: covariance matrix, expected returns, Sharpe ratio, Sortino ratio
Practical application for Jarvis: allocate capital across uncorrelated strategies
  Current system risk: all strategies trade same universe → high correlation
  Improvement: add mean-reversion strategy to complement trend/momentum bot
  Target correlation: < 0.3 between strategies for diversification benefit
Risk parity: size each strategy inversely to its volatility (equal risk contribution)
Max drawdown constraint: Jarvis should enforce portfolio-level max drawdown (5%)

── 17. VOLATILITY TRADING ─────────────────────────────────────────────────────
VIX strategies:
  VIX < 12: complacency — sell premium, expect eventual mean reversion up
  VIX 12–20: normal — standard directional strategies
  VIX 20–30: elevated — reduce size, wider stops, avoid overnight holds
  VIX > 30: fear — counter-trend reversals from SMC sweeps work well; reduce size 50%
  VIX term structure: VIX3M > VIX = contango (normal); VIX > VIX3M = backwardation (fear spike)
UVXY trading note (current universe): UVXY is 1.5x long VIX futures
  → rises when VIX spikes; decays dramatically in contango environments
  → best for short-term momentum plays during fear spikes; NEVER hold overnight

── 18. GAP TRADING ────────────────────────────────────────────────────────────
Gap types: full gap up/down, partial gap, gap within gap
Gap and Go (momentum): stock gaps > 3% on high volume → trade continuation with VWAP as stop
Gap Fill (reversion): stock gaps < 3% on average volume → fade back to previous close
Rules: only trade gaps > 1.5% to ensure meaningful move; check sector correlation
Best gaps: earnings > analyst upgrade > sector news > market gap
Pre-market screening: look for stocks gapping with catalyst AND above-average pre-market volume
ICT note: gap fills often happen at VWAP; unmitigated FVGs from the gap are prime targets

── 19. QUANTITATIVE / SYSTEMATIC APPROACHES ──────────────────────────────────
Backtesting principles (anti-overfitting):
  Walk-forward optimization: never optimize on the full dataset
  Out-of-sample: reserve last 20% of data as holdout (implemented in Jarvis Observer)
  Robustness: strategy should work on multiple similar instruments
  Transaction costs: model slippage as 0.05% per trade minimum
Statistical significance: need p < 0.05 AND N > 30 trades minimum to claim edge
Alpha decay: edges erode over time as more traders discover them; monitor rolling WR monthly
Feature importance: use permutation importance to identify which features drive edge
Regime detection: HMM (Hidden Markov Model) to identify bull/bear/chop regimes
  → adapt strategy parameters per regime (already partially in Jarvis features: adx, ema_cross)

── 20. MARKET MICROSTRUCTURE FOR ALGOS ───────────────────────────────────────
Execution algorithms:
  TWAP: time-weighted average price — spread orders over time
  VWAP: volume-weighted — execute proportional to volume profile
  Implementation shortfall: minimize difference between decision price and final fill
Latency considerations: for 5-min bars, latency < 1 second is irrelevant
Adverse selection: don't trade in the first 5 minutes of session (max spread/manipulation)
Price impact model: for symbols in current universe, 1000 share orders = ~0.05% impact
Order types: limit orders preferred; market orders for momentum entries only
Broker note: Alpaca paper trading may have execution timing that differs from live fills

=== CROSS-STRATEGY SYNTHESIS FOR JARVIS COUNCIL ===

When the Researcher brainstorms, consider:
1. SMC/ICT already handles TREND entries → mean reversion fills the gap for ranging markets
2. Current system has NO volatility adjustment → VIX filter is highest-priority improvement
3. GEX data (now available in Jarvis) tells you whether SMC breakouts or VWAP fades are favored
4. Kelly sizing should replace fixed 35% position size as track record builds
5. Pairs among current universe: RIOT/MARA (crypto miners), TQQQ/QQQ (leveraged)
6. Wyckoff accumulation phase on daily → ICT kill zone entry on 15m is highest-conviction setup
7. Earnings plays apply to: TSLA, DDOG, NET — adjust position size or avoid in earnings week
`

export const TRADING_LIBRARY_COMPACT = `Strategy library: mean-reversion (RSI extremes, BB breach), trend-following (EMA cross + ADX>25), breakout (Donchian + vol surge), VWAP (reversion/trend/anchored), momentum (RS ranking), stat-arb pairs (ZScore>2), Kelly sizing (half-Kelly recommended), microstructure (order flow delta, footprint), Elliott Wave (5-wave impulse fib targets), Wyckoff (accumulation/distribution phases), seasonality (sell-in-May, OPEX pinning, turn-of-month), earnings (IV crush, gap plays), options (condor/straddle/spread), delta-neutral (GEX interpretation: negative=trending, positive=pinning), portfolio optimization (Sharpe/covariance), VIX regime (>30=reduce size 50%), gap trading (gap+go vs gap fade), quant (walk-forward, regime HMM, alpha decay monitoring)`
