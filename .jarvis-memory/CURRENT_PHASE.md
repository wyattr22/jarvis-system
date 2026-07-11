# Current Phase

**Phase 12 — Trading Engine Overhaul: COMPLETE (12.1–12.11, 2026-07-06 → 2026-07-10).** Phase 11 complete.

## Phase 14 — Optimization (started 2026-07-10)

| Step | What | Status |
|---|---|---|
| 14.1 | Broad-coverage news back alongside reputable core (user request; Reuters feed dead, skipped) | ✅ merged (#86) |
| 14.2 | Bracket exits + PDT guard: auto-execute derives take-profit from expected R → full bracket at the broker; day-trade guard (<$25k equity, 3 DTs) with audit + humanized slug | ✅ this PR |
| 14.3+ | Candidates (user to prioritize): parameter auto-optimizer sweep via backtester; win-prob calibration from shadow outcomes; /universe page; persist backtest runs; charts page → universe symbols; git-connect Vercel; real embeddings (KNOWN_ISSUES) | queued |

## Phase 13 — Agent crew (started 2026-07-10)

| Step | What | Status |
|---|---|---|
| 13.1 | Ops agent: daily health monitor + push alerts (also fixed auto-cycle heartbeat gap) | ✅ merged (#82) |
| 13.2a | Reputable-only news sources | ✅ merged (#83) |
| 13.2 | Research agent | ✅ merged (#84) |
| 13.3 | Daily digest: post-close narrative from humanized audit log + signals + orders + P&L + morning research; daily_digests table; /digest page (DEBRIEF in sidebar, both feeds); push notification 20:45 UTC weekdays | ✅ this PR |

## Phase 12 step table (user-driven scope)

| Step | What | Status |
|---|---|---|
| 12.1 | Markets tiles → TradingView chart popup (modal + tv-symbol mapping) | ✅ merged (#71) |
| 12.2 | Remove drift monitor | ✅ merged (#72) |
| 12.3 | Whole-market scanner → rotating universe (12,659 symbols/35s live-verified) | ✅ merged (#73) |
| 12.4 | Internal signal engine over the universe | ✅ merged (#74) |
| 12.5 | Features: live compute any symbol | ✅ merged (#75) |
| 12.8 | Auto-execute loop (done out of order — highest user value): signal→opportunity promotion + auto cycle behind `auto_execute` master switch (default OFF, /risk-config), market-hours gate, Risk-Manager veto, ≤3 orders/cycle, `/api/execution/auto-cycle` pinger endpoint, AUTO-EXECUTE badge on /bot. Pinger recipe in domain/api-budgets.md | ✅ this PR |
| 12.6 | Adjustable backtest (strategy builder) | ✅ merged (#77) |
| 12.7 | Shadow vs live comparison | ✅ merged (#78) |
| 12.8 | Auto-execute loop on paper + master switch (user chose: auto-execute, cron-job.org pinger for intraday cadence) | queued |
| 12.9 | Council transparency (deliberation timeline) | ✅ merged (#79) |
| 12.10 | Humanized audit log + meta-decisions (+ audit API column fix) | ✅ merged (#80) |
| 12.11 | UI polish: /markets unified onto the CSS token system (was near-miss hexes), page/panel headers match the app-wide type scale, :focus-visible ring, prefers-reduced-motion, tile hover glow, sidebar group dividers + aria-current + larger targets | ✅ this PR |

## Previous phase (11) — Full Market Visibility (COMPLETE, deployed)

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
| 11.3 | phase-11.3/finnhub-provider — key deployed 2026-07-06; **Finnhub free tier paywalls ALL forex** (probed), so forex stays Yahoo `PAIR=X` and Finnhub covers earnings + quotes + search | ✅ this PR |
| 11.4 | phase-11.4/alpaca-options-chain (done before 11.3 — key not gated) | ✅ merged (#61) |
| 11.5 | phase-11.5/futures-indexes-catalog | ✅ merged (#62) |
| 11.6 | phase-11.6/instrument-model | ✅ merged (#63) |
| 11.7 | phase-11.7/markets-page | ✅ merged (#64) |
| 11.8 | phase-11.8/watchlist-universe | ✅ merged (#65) |
| 11.9 | phase-11.9/llm-chain-and-api-audit | ✅ merged (#66) |
| 11.10 | phase-11.10/mcp-markets-tool | ✅ merged (#67) |
| 11.11 | phase-11.11/hobby-cron-compliance — Vercel Hobby rejects sub-daily crons; 4 schedules downgraded to daily (see KNOWN_ISSUES for the free external-pinger recipe) | ✅ this PR |

## This PR (11.3) — Finnhub provider (revised scope)

Probed the live key before building: Finnhub free tier now **paywalls all
forex endpoints** (`/forex/rates`, per-pair quotes, candles all 403). What
still works free: `/quote` (real-time US equities), `/calendar/earnings`,
`/search`. Scope revised accordingly:

- `finnhub.ts`: `getFinnhubQuote` (MarketQuote, realtime meta),
  `getFinnhubEarnings` (mapped to legacy EarningsItem, 1h Redis cache),
  `searchFinnhubSymbols`. All budgeted (55/min) via 11.2 infra.
- `earnings.ts`: dispatcher — Finnhub primary, Alpha Vantage fallback.
  Fixes the AV 25/day budget breach. `economics.ts` revalidate 1h→2h
  (12 AV calls/day).
- `/markets` forex grid ACTIVATED with Yahoo `PAIR=X` majors (8 pairs,
  honest DELAYED badges) — was a setup placeholder.
- Symbol search: Finnhub fallback when the universe index returns <3 hits.
- whitelist +finnhub.io; quality specs finnhub.quote/finnhub.earnings.
- Live-verified: AAPL 308.63 realtime via finnhub.quote; earnings dispatcher
  returned 297 Finnhub rows.

**Phase 11 is now COMPLETE (11.0–11.12; Oanda step remains optional/deferred).**

## Previous PR (11.10) — MCP markets tools

- `markets.overview` — the /markets aggregate (indexes, futures+proxies,
  macro, sectors, movers, SPY options pulse) with `meta` freshness on every
  quote; description tells LLM clients delayed values are context, not
  signal timing. Scope `read:signals`.
- `markets.quote` — cross-asset quote via the same parseInstrument dispatch
  as `/api/quote/[symbol]`.
- Registry now 22 tools; registry smoke test extended.
- KNOWN_ISSUES: `domain/mcp-tool-catalog.md` linked from INDEX.md never
  existed — generate from `listTools()` later.

**Phase 11 core is COMPLETE except 11.3 (Finnhub provider) — still gated on
FINNHUB_API_KEY landing in Vercel env.** When the key appears: build 11.3
(finnhub.ts provider, earnings migration off Alpha Vantage, forex-grid
activation on /markets, forex primary in the quote dispatch).

## Previous PR (11.9) — LLM chain reorder + API budget audit

- `providers.ts`: explicit `priority` field; Cerebras-70b first (1M tok/day
  free vs Groq ~1K req/day); router candidates sorted by it.
- SambaNova fully removed: `ProviderName`, whitelist host, voice route's
  direct call + round 3. **User: delete SAMBANOVA_API_KEY from Vercel.**
- `domain/api-budgets.md` — the audit: every external API, free-tier cap,
  worst-case demand, headroom, fallback, delay-honesty table + trading-impact
  note. Linked from INDEX.md.
- DECISIONS entry for the chain order.

## Previous PR (11.8) — watchlist universe + cross-asset search

- SSE stream (`/api/stream`) now reads symbols from the DB watchlist
  (re-read every ~60s, equities-only via `parseInstrument`, cap 25, legacy
  defaults as fallback) instead of the hardcoded 12; payload rows are
  MarketQuotes with `meta` (legacy `mid` kept for old consumers).
- `/api/quote/[symbol]` dispatches by parsed asset class: equity/crypto →
  Alpaca IEX, forex → Yahoo `PAIR=X` (until 11.3 Finnhub), futures → Yahoo.
  Always returns MarketQuote + legacy fields. Live-verified: EUR_USD 1.1432,
  ES=F 7553.25, AAPL 308.43 with correct per-source meta.
- `/api/symbols/search` — full Alpaca `/v2/assets` equity universe (cached
  24h in Redis) + futures/forex/index catalogs, ranked exact > prefix > name
  substring (`rankSymbolMatches` pure + tested).
- Watchlist page: cross-asset typeahead + FreshnessBadge on every quote.

## Previous PR (11.7) — /markets overview page

The visible payoff: one cockpit for indexes, futures (delayed + live ETF proxy
side-by-side), forex (placeholder until FINNHUB_API_KEY + 11.3), macro,
11-SPDR sector heatmap, whole-market movers (incl. small caps), and SPY/QQQ
options pulse. Every price wears a `FreshnessBadge` (LIVE / DELAYED Xm / EOD /
STALE — computed from actual print age, so weekend quotes honestly show EOD).

- `components/ui/freshness-badge.tsx` — the honesty artifact; tooltip explains
  IEX thinness on the LIVE badge.
- `markets/page.tsx` + 7 streaming Suspense sections; `loading.tsx` skeleton.
- `alpaca.ts`: `getMovers()` (free screener endpoint) + sectors extended to
  all 11 SPDRs (added XLP, XLU, XLRE, XLB).
- Heatmap polarity pair `#00a37d`/`#e64545` validated with the dataviz palette
  checker against the dark surface; signed % text in every cell (never
  color-alone).
- Verified with a production build + live render: HTTP 200, all sections
  populated, 28 DELAYED / 36 EOD / 2 LIVE badges on a Saturday (honest).
- Note: the long-running local dev server (PID 86952, since Jun 26) has stale
  Alpaca keys in its process env — its API routes 401. Restart it to fix.

## Previous PR (11.6) — instrument model

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
