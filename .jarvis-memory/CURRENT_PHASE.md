# Current Phase

**Phase 11 — Full Market Visibility (in flight, started 2026-07-05).**

Plan: `/Users/wyattrantz/.claude/plans/ok-i-want-to-sprightly-puppy.md`

## Scope (user-locked decisions)

- Visibility only — futures/forex broker execution stays stubbed.
- Free data providers only; data delays surfaced honestly in the UI
  (freshness badges), not hidden.
- Forex via Finnhub (Oanda KYC deferred). SambaNova removed (11.9).
  OpenRouter key to be deployed by user.

## Free-tier probe results (2026-07-05, real key)

| Endpoint | Result |
|---|---|
| Alpaca indices (`/v1beta1/indices/...`, new June 2026) | 403 — paid add-on. Indexes stay on Yahoo (delayed, labeled). |
| Alpaca options chain (`feed=indicative`) | 200 — replaces Yahoo options scrape in 11.4. |
| Alpaca movers screener (`/v1beta1/screener/stocks/movers`) | 200 — small+large cap movers for 11.7. |

## Step table

| Step | Branch | Status |
|---|---|---|
| 11.0 | (no PR) sync main — **PR #58 landed the 57-PR stack on main**; local main synced; baseline green (89 tests) | ✅ done |
| 11.1 | phase-11.1/env-audit-housekeeping | ✅ merged (#59) |
| 11.2 | phase-11.2/quote-freshness-core | ✅ merged (#60) |
| 11.3 | phase-11.3/finnhub-provider (gated: FINNHUB_API_KEY in Vercel — **still not added**) | queued |
| 11.4 | phase-11.4/alpaca-options-chain (done before 11.3 — key not gated) | ✅ merged (#61) |
| 11.5 | phase-11.5/futures-indexes-catalog | ✅ merged (#62) |
| 11.6 | phase-11.6/instrument-model | ✅ this PR |
| 11.7 | phase-11.7/markets-page | queued |
| 11.8 | phase-11.8/watchlist-universe | queued |
| 11.9 | phase-11.9/llm-chain-and-api-audit | queued |
| 11.10 | phase-11.10/mcp-markets-tool | queued |

## This PR (11.6) — instrument model

Parser util, NOT new DB columns — `instrument TEXT` stays canonical; structure
derived on read; 100% backward compatible with existing opportunity rows.

- `instruments/parse.ts` — `parseInstrument(raw, hint?)`: OCC options
  (root+YYMMDD+C/P+strike*1000, date-validated), dated futures (month codes
  FGHJKMNQUVXZ, catalog-gated roots so plain tickers can't misparse), Yahoo
  continuous (`ES=F`), forex normalization (`EURUSD`/`EUR_USD`→`EUR/USD`,
  currency-code-gated), equity fallthrough honoring the hint.
- `instruments/format.ts` — "SPY 18 Jul '25 $550 Call", "S&P 500 E-mini
  Sep '26", etc.
- Opportunities dashboard renders formatted non-equity instruments (raw OCC
  string kept in the title tooltip).

## Previous PR (11.5) — futures + indexes catalog

- `yahoo.ts` — shared budget-aware Yahoo chart fetcher → `MarketQuote` with
  honest delayed meta; rides the 11.2 stale-shadow cache.
- `futures.ts` — 11 continuous contracts (ES NQ YM RTY GC SI CL NG ZN ZB 6E).
- `indexes.ts` — ^GSPC ^NDX ^DJI ^RUT ^VIX ^TNX + **DX-Y.NYB** (Yahoo's
  `^DXY` is dead — price=None since 2019 — so intermarket `dxy` had been
  silently null; fixed).
- `instruments/proxies.ts` — future→real-time-ETF pairing table (see
  DECISIONS.md 2026-07-05 entry).
- `intermarket.ts` refactored onto the shared fetcher (same exported shape).
- quality specs `yahoo.futures` / `yahoo.index` (validate shape + that meta
  never claims realtime) + gated wrappers.
- Live-verified: 11/11 futures, 7/7 indexes, dxy=100.945.

## Previous PR (11.4) — Alpaca options chain

- `options-math.ts` — pure, provider-agnostic positioning math extracted from
  the old Yahoo-only path: `computeMaxPain`, `computePcRatio`, `computeGex`,
  `topWalls`, `bsGamma`. Fully unit-tested on synthetic books.
- `alpaca-options.ts` — free-tier chain: trading-API `/v2/options/contracts`
  (real OI; probe confirmed 810 OI on SPY 740C) + indicative snapshots for
  IV/quote timestamps. Picks the highest-OI expiry 5–12 days out, ±15% strike
  band, drops zero-OI contracts. OCC symbols are canonical instrument strings.
- `options.ts` — dispatcher: Alpaca primary → Yahoo scrape fallback; both
  normalize to `OptionContract[]`; `OptionsSnapshot` gains `meta: QuoteMeta`
  (alpaca.options = 900s delay).
- **Bug fix:** the `yahoo.options` quality spec validated raw-chain fields
  (`o.calls || o.puts`) that `OptionsSnapshot` never had — every options fetch
  scored `ok:false`, so options data NEVER reached LLM context. Replaced with
  `options.snapshot` spec validating the actual shape.
- Live-verified: SPY spot 744.07, maxPain 745, P/C 0.75, GEX +$1.65B via
  the Alpaca path.

## Previous PR (11.2) — quote freshness core

The metadata contract every Phase 11 surface conforms to:

- `src/lib/data/freshness.ts` — `QuoteMeta {source, asOf, delaySeconds,
  realtime}`, `MarketQuote`, `SOURCE_DELAYS` registry, `freshnessOf()`
  classifier (realtime/delayed/eod, computed from actual asOf age, not just
  nominal feed delay).
- `src/lib/data/budget.ts` — Redis fixed-window budgeter with safety margins
  under each free-tier cap (finnhub 55/min, alphavantage 22/day,
  alpaca_data 180/min, yahoo 120/min self-imposed). Fails open on Redis error.
- `src/lib/data/quote-cache.ts` — `cachedQuote()` = cache → budget check →
  fetch, with a 24h stale shadow copy so provider outages/over-budget degrade
  to "stale + badge" instead of blanking pages.
- `alpaca.ts` — additive `getMarketQuotes()` + exported pure
  `mapSnapshotToMarketQuote()` (changePct from prevDailyBar). Legacy `Quote`
  shape untouched.

19 new tests (freshness boundaries, budget windows/rollover/fail-open,
cache/shadow/stale paths).

## Important discovery (11.0)

The 57 phase PRs merged as a stack — each into the previous phase branch —
so main never received them until PR #58. Production Vercel deploys had been
CLI-pushed from the local working tree (`gitDirty`). Main and production are
now aligned. Note for later: SAMBANOVA_API_KEY has a direct usage in
`src/app/api/voice/route.ts:757` (bypasses provider registry) — handle in 11.9.

## User action items

1. ~~Finnhub key signup~~ — user signed up; **key not yet visible in Vercel env** (gates 11.3)
2. Deploy `OPENROUTER_API_KEY` to Vercel
3. Delete `SAMBANOVA_API_KEY` from Vercel (during 11.9)

## Pacing rule (still in force)

One numbered step = one branch = one PR = one merge. Update this file at the
end of every PR.
