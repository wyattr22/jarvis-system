// Full extraction of bot.py SMC/ICT v4 logic — used by Researcher, Observer, and Jarvis voice

export const SMC_ICT_KNOWLEDGE = `
=== SMC/ICT v4 STRATEGY — COMPLETE SPECIFICATION ===

CORE PHILOSOPHY:
Smart Money Concepts (SMC) / Inner Circle Trader (ICT) methodology assumes institutional
players (banks, funds) leave footprints in price action. The strategy trades WITH institutional
flow by identifying: (1) where liquidity was swept, (2) the displacement candle that confirms
intent, (3) the retracement into a premium/discount zone, (4) the confirmation candle.

STRATEGY LAYERS (applied in sequence — all must align):
1. DAILY BIAS: prior-day high/low + 1H swing levels determine overall direction for the session
2. KILL ZONES: only enter during these 4 institutional windows:
   - NY Open:       09:30–10:15 ET (45-min window — institutional participation peaks)
   - NY Lunch:      12:00–12:30 ET (noon repositioning)
   - London Close:  13:00–13:30 ET (London books square, reversal setups)
   - NY PM:         14:30–15:00 ET (last-hour momentum continuation)
3. LIQUIDITY RAID: price must sweep a prior high (buy-side liquidity) or low (sell-side liquidity)
   at a higher-timeframe (HTF) level BEFORE the entry setup forms
4. 15M CANDLE CONFIRMATION: entry candle must close in the direction of daily bias
5. SPY TREND FILTER: skip counter-trend trades (long bias requires SPY in uptrend via EMA9/EMA21)
   SPY trend determined by SPY open vs current price: >+1% = bullish, <-1% = bearish, else neutral
6. REVERSAL CONFLUENCES — need 2 of 3:
   a) Inverse Fair Value Gap (IFVG): gap in the opposite direction that price is now filling
   b) Break of Structure (BOS) with buffer: market structure shifts with confirmation buffer
   c) OTE Fibonacci (0.62–0.79 range): Optimal Trade Entry zone on the displacement move
7. CONTINUATION CONFLUENCES — need 1 of 4:
   a) Fair Value Gap (FVG): imbalance zone where price moves too fast, leaves a gap
   b) Equilibrium (EQ): 50% retracement of a swing (institutional balance point)
   c) Order Block (OB): the last bearish candle before a bullish impulse (or vice versa)
   d) Breaker Block: a failed order block that gets retested from the other side
8. BREAKOUT GATE: price > EMA9 > EMA21 (bullish) or price < EMA9 < EMA21 (bearish),
   RSI 40–80, volume ≥ 1x avg volume
9. QUALITY GATES: ATR > 0.4% of price, candle body < 4x avg body (no blow-off tops), min price $2,
   structure-based SL (NOT fixed %) — SL placed at structure low/high from a 30-bar lookback,
   capped at MAX_STOP_RISK_PCT=3%, R:R ≥ 2.0 required
10. ORDER TYPE: bracket order — market entry, TP/SL from structure
    TP LOGIC: uses DOL (Daily Open Level) if DOL > entry*(1+2%) for longs, else fixed 4%
    SL LOGIC: structure-based (swing low for longs, swing high for shorts), max 3%

CURRENT PARAMETERS (from config):
  TAKE_PROFIT_PCT    = 0.04   (4% TP)
  MAX_STOP_RISK_PCT  = 0.03   (3% max SL)
  MIN_RR_RATIO       = 2.0    (minimum 2:1 reward:risk required)
  POSITION_SIZE_PCT  = 0.35   (35% of equity per trade — scales with account)
  MAX_RISK_PCT       = 0.03   (3% of equity max risk per trade)
  MAX_POSITIONS      = 5      (max concurrent open positions)
  DAILY_LOSS_LIMIT_PCT = 0.024 (stop trading symbol if -2.4% equity in one day)
  FVG_MIN_SIZE_PCT   = 0.001  (FVG must be ≥ 0.1% of price to qualify)
  SWING_LOOKBACK     = 8      (bars to look back/forward for swing detection)
  FIBO_OTE_LOW       = 0.62   (OTE zone starts at 61.8% fib retracement)
  FIBO_OTE_HIGH      = 0.79   (OTE zone ends at 78.6% fib retracement)
  FIBO_TOLERANCE     = 0.035  (3.5% tolerance on fib levels)
  RSI_MIN            = 40, RSI_MAX = 80
  EMA_FAST           = 9, EMA_SLOW = 21
  ATR_PERIOD         = 14, ATR_MIN_PCT = 0.004, MAX_CANDLE_MULT = 4.0
  SCAN_INTERVAL_MIN  = 5 (scan every 5 minutes)
  EOD_CLOSE_TIME     = "15:45" (all positions closed before market close)

UNIVERSE (12 symbols — final curated, every one profitable in 18-month backtest v22):
  Crypto miners: RIOT, MARA, HUT     (high beta, crypto correlation — BTC filter important)
  Defense/drone: RCAT                (momentum-driven, low correlation to tech)
  Quantum:       IONQ                (high volatility, options-driven moves)
  Megacap vol:   TSLA                (liquid, consistent ICT setups)
  Sentiment:     UVXY, HOOD, SNAP   (UVXY = inverse VIX, requires special handling)
  Photonics/AI:  ALAB, AAOI, CRDO   (AI data-center laser/photonics — emerging edge)

  NOTE: ACHR, CELH, TQQQ, CONL, SQ, DDOG, NET were removed in backtest v22 (underperformed).
  The council should NOT propose adding them back without new statistical evidence.

V22 BASELINE PERFORMANCE (18-month backtest, $100k starting capital):
  Total return: +50.1% ($50,115) | Win rate: 71.8% | Profit factor: 2.30
  Trades: 259 | Avg win: ~$347 | Avg loss: ~$-150 | Max drawdown: ~3%
  This is the benchmark — any proposed change must beat these numbers in walk-forward.

PER-SYMBOL PERFORMANCE (v22 backtest, ranked by P&L):
  IONQ  : 24 trades, 62% WR, $9,984  — top earner (high avg win from quantum vol)
  TSLA  : 22 trades, 82% WR, $6,123  — most reliable WR, clean ICT setups
  MARA  : 39 trades, 67% WR, $5,989  — BULL ONLY (degraded to -$2.6k in later research)
  AAOI  : 22 trades, 64% WR, $5,129  — photonics/AI datacenter, consistent
  HUT   : 16 trades, 69% WR, $4,684  — crypto miner, bull-dependent like MARA
  ALAB  : 12 trades, 92% WR, $4,387  — HIGHEST WR in universe, AI semi, very selective
  HOOD  : 33 trades, 70% WR, $4,007  — high volume of setups, consistent
  SNAP  : 12 trades, 83% WR, $3,767  — social media, high ATR, very selective
  CRDO  : 19 trades, 79% WR, $3,142  — connectivity chips, degraded in later research
  UVXY  :  30 trades, 77% WR, $2,711  — inverse VIX, needs special handling
  RIOT  : 20 trades, 70% WR, $346   — OK WR but low avg win, least productive crypto miner
  BITF  : 10 trades, 60% WR, $-153  — REMOVED, replaced by RCAT (RCAT not in v22 backtest)
  NOTE: RCAT and AAOI/CRDO replaced BITF in live v22 bot — performance unknown until fills come in.
  NOTE: MARA's v22 numbers look great but are bull-period biased — it failed in later multi-regime tests.

BANNED SYMBOLS (do NOT propose adding to universe — either Alpaca-restricted or strategy-excluded):
  COIN, AMD, NVDA, PLTR, RGTI, DDOG, NET, CELH, TQQQ, ROKU, BBAI,
  SQQQ, SPXU, SDOW, IREN, CONL, ACHR, MSTR
  Note: SQQQ/SPXU appear in research backtests (v38+) as bear ETF instruments.
  Whether Alpaca paper allows them or not needs to be verified before proposing.

KNOWN EDGES:
  - NY Open kill zone has highest win rate (institutional flow most concentrated)
  - OTE + FVG confluence is the highest-probability reversal pattern
  - SPY trend filter eliminates ~30% of losing trades (counter-trend fades)
  - Equal highs/lows (liquidity) sweep followed by BOS = 65%+ win rate historically
  - Prior day range/ATR ratio > 1.5 = volatile session — tighten position size

KNOWN WEAKNESSES:
  - Choppy/ranging sessions (ADX < 15) produce false BOS signals
  - Economic news events invalidate structure (avoid 15min before/after major releases)
  - Low-float stocks (< $5) have wide spreads that eat into R
  - UVXY is an outlier — inverse of VIX movements require special handling
  - 15:00–15:45 window has elevated false signals due to EOD position squaring

=== RESEARCH PIPELINE (v25–v41) — WHAT THE COUNCIL SHOULD KNOW ===

The live bot is v22. Research has continued to v41. The council's job is to propose
bringing the most statistically validated improvements from the research into production.

REGIME SCORING SYSTEM (v26+):
  The breakthrough from v25→v26 was a regime score computed daily using 7 cross-sector ETFs:
    SPY  = broad market direction
    IWM  = small cap / risk appetite (divergence from SPY = risk-off signal)
    HYG  = high-yield credit spread (credit stress precedes equity drawdowns)
    LQD  = investment-grade credit
    XLY  = consumer discretionary (risk-on consumption)
    XLP  = consumer staples (defensive rotation indicator)
    TLT  = long-term treasuries (flight-to-quality / rate sensitivity)
  Score is a composite of these ETFs' momentum, correlation, and spread.
  Score > +0.20 = bull regime, < -0.10 = bear regime, between = chop.
  This SIGNIFICANTLY improved performance: v26 +$15,600 vs v25 +$6,200.

  EXACT REGIME WEIGHT FORMULA (from v26-v39):
    regime_score = (spy_ema200_signal × 0.30)  ← SPY above/below 200-day EMA
                 + (hyg_lqd_signal   × 0.20)  ← HYG outperforming LQD = risk-on
                 + (iwm_spy_signal   × 0.15)  ← IWM outperforming SPY = risk appetite
                 + (xly_xlp_signal  × 0.15)  ← XLY outperforming XLP = growth vs defensive
                 + (spy_tlt_signal   × 0.20)  ← SPY outperforming TLT = equities over bonds
    Total = -1.0 to +1.0. Symbol activation thresholds set per-symbol.

TIERED SYMBOL ACTIVATION (v35+):
  Symbols have activation thresholds based on regime score.
  Each symbol only trades when regime score crosses its threshold:
    Positive threshold = only longs in sufficiently bullish regime
    Negative threshold = bear ETF, only shorts in bear regime

BEST PERFORMING RESEARCH (v38): $27,570 across 3 windows, 45% WR with high avg win
  Universe: ALAB, HUT, HOOD, IONQ, SHOP, SMCI, DKNG, TSLA, SNAP (bull longs)
            LABD, SPXU (bear ETFs — only short in bear regime)
  Key finding: having BEAR INSTRUMENTS (LABD, SPXU) active in bear regimes
  captures the downside without blowing up in bull markets.

FAILED SYMBOLS (removed across research):
  MARA: structurally bad actor — net -$2,684 across v34 windows, 19-36% WR.
        Fires at regime peaks = worst entries. Do NOT re-add.
  CRDO: net -$927 across v34 windows. OTE strategy doesn't suit its behavior.
  ACHR, CELH, TQQQ, CONL, SQ, DDOG, NET: removed in v22 due to underperformance.

SYMBOLS THAT PERFORM WELL IN SPECIFIC REGIMES:
  TSLA: works across regimes (core position, 60%+ WR in bull)
  HOOD: bull-dependent (29-33% WR in bear, 49-62% WR in bull)
  ALAB: cross-regime stable (48-67% WR across all regimes — AI infrastructure)
  HUT:  strong bull only (55% WR bull, 19% bear — treat like crypto beta)
  IONQ: net positive in bull, negative in bear — gate on regime score > +0.20
  UVXY: inverse volatility — use as hedge instrument, not as directional trade
  LABD: 3x inverse biotech — 67% WR in bear regimes (best bear instrument)
  SPXU: 3x inverse S&P — consistent bear coverage, less volatile than LABD

WHY v39 FAILED (critical lesson — do NOT repeat):
  v39 attempted two-sided trading (longs AND shorts on regular symbols in bear regime).
  Result: -$6,884 (worst backtest in the series).
  Root cause: the OTE/IFVG/BOS entry framework is designed for longs. Applying the same
  logic to shorts on high-beta stocks in bear markets produced 37% WR on the short side —
  permanently below break-even. Shorts don't work on HOOD, IONQ, ALAB, etc. because:
  - These are structural up-trending stocks (short squeezes on any bounce)
  - The "bearish OTE" pattern doesn't hold the same way as bullish OTE
  - Bear markets in individual names are choppy/volatile, not clean retracements
  LESSON: Bear market exposure requires DEDICATED BEAR INSTRUMENTS (LABD, SPXU) not
  flipping the long framework. v40/v41 corrected this by using proper bear ETFs.

ADVANCED EXIT MECHANICS (v40/v41 research):
  Partial profit at 1.5R: take 50% position off, move SL to breakeven on remainder.
  This improves consistency — locks in gains on winning trades, eliminates losing trades.
  Bear ETF specific: tighter trail at 2.5 ATR vs 3.0 ATR for longs.
  UVXY spike filter: if UVXY +5% above prior daily close → skip all bull longs for the day.
  SPY micro-filter: if SPY 5m price drops >1% below its 20-period 5m EMA → skip bull longs.

V41 REGIME STATE MACHINE (current research frontier):
  5 regime states (BULL/TOPPING/BEAR/BOTTOMING/CHOP) each with:
    - Different active symbol tier
    - Different position size (25-45%)
    - Different max positions (2-5)
    - Different kill zone priority
  This is the proposed direction for the next live bot version.

IMPROVEMENT HYPOTHESES (ready for council proposals):
  HIGH PRIORITY (validated in research, not yet in live bot):
    - Add regime scoring (7 cross-sector ETFs) — expected +50% improvement based on v26 data
    - Add LABD/SPXU as bear instruments, activate when regime score < -0.10
    - Gate HOOD and HUT on regime score > +0.28 (avoid bear market blowups)
    - Dynamic position sizing: 40% in bull, 25% in topping/chop, 45% in bear ETFs

  MEDIUM PRIORITY (tested, mixed results):
    - SHOP: 65-67% WR in bull windows — strong candidate for bull tier
    - SMCI: positive across windows in v35-v38 — server infra consistent
    - DKNG: positive in bull — sports betting correlated to risk appetite
    - SNAP: high ATR, added in v38 for W3 coverage — needs more data

  LOW PRIORITY / EXPLORATORY:
    - London Close kill zone removal (v40 data shows 47% loss rate in 13:00-13:30)
    - Intraday micro-filter: skip bull longs if SPY 5m drops >1% below EMA20
    - Partial profit at 1.5R then move SL to breakeven (tested in v40/v41)
`

export const SMC_ICT_COMPACT = `SMC/ICT v4 live (bot.py v22): 4 kill zones (NY open 9:30-10:15, lunch 12:00-12:30, London close 13:00-13:30, NY PM 14:30-15:00 ET), 2/3 reversal (IFVG+BOS+OTE 0.62-0.79) + 1/4 continuation (FVG/EQ/OB/BREAKER), SPY trend filter, RSI 40-80, R:R≥2, TP=DOL or 4%, SL=structure max 3%, 12 symbols: RIOT MARA HUT RCAT IONQ TSLA UVXY HOOD SNAP ALAB AAOI CRDO. RESEARCH (v38 best): regime scoring via SPY/IWM/HYG/LQD/XLY/XLP/TLT, tiered symbols, bear ETFs LABD/SPXU in bear regime, MARA permanently removed (structural bad actor)`
