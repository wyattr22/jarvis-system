# Free-Tier API Budget Audit (2026-07-05, Phase 11.9)

Every external API Jarvis touches, its free-tier cap, our worst-case
consumption, and the fallback when it's down or over budget. The runtime
budgeter (`src/lib/data/budget.ts`) enforces the "our limit" column with a
safety margin; over-budget requests serve the 24h stale-shadow copy
(`quote-cache.ts`) instead of burning the cap.

## Market data

| Provider | Free-tier cap | Our limit (budgeter) | Worst-case demand | Headroom | Fallback |
|---|---|---|---|---|---|
| Alpaca Market Data (IEX) | 200 req/min | 180/min | SSE stream 20/min + /markets ~10/min + bars/pages ~20/min ≈ 50/min | ~4× | stale shadow → error note |
| Alpaca screener (movers) | part of data quota | — (60s Redis TTL) | 1/min | large | section degrades |
| Alpaca options (indicative + contracts) | part of data quota | — (request-time) | ~4 req per options-pulse render, cached | large | Yahoo options scrape |
| Alpaca /v2/assets universe | trading API, generous | — (24h Redis cache) | 1/day | huge | catalog-only search |
| Yahoo Finance (unofficial) | no SLA — politeness | 120/min | futures 11 + indexes 7 per 60s TTL ≈ 18/min cold | ~6× | stale shadow → ETF proxies |
| Finnhub | 60 req/min | 55/min | earnings 1/hr + equity quote/search ad-hoc | ~10× | AV earnings; Alpaca quotes. **ALL forex endpoints paywalled on free tier (probed 2026-07-05 with the live key)** |
| Yahoo forex `PAIR=X` | no SLA — politeness | shares yahoo 120/min | 8 majors per 60s TTL | large | stale shadow. Primary forex source since Finnhub free has none |
| Alpha Vantage | **25 req/day** (dropped from 500) | 22/day | economics at 2h TTL = 12/day (earnings migrated to Finnhub in 11.3) | ~2× | cached/empty calendar |
| StockTwits | ~200 req/hr | — (5min revalidate) | per-symbol context calls | ok | skip sentiment |
| SEC EDGAR | fair use | — (1h revalidate) | insider checks | ok | skip |

## LLM chain (priority order after 11.9)

| Priority | Model | Free tier | Why this order |
|---|---|---|---|
| 1 | cerebras-llama-70b | **1M tokens/day**, 30 RPM | Most generous renewable quota by far |
| 2 | groq-llama-70b | ~500K tok/day, 30 RPM, 6K TPM | Quality peer, tighter per-minute budget |
| 3 | groq-llama-8b | 30K TPM | High-throughput workhorse |
| 4 | cerebras-qwen-32b | shares Cerebras quota | Family diversity for council votes |
| 5 | openrouter-deepseek-r1 | 50 req/day (1000/day after one-time $10) | Last resort + deepseek family diversity |

Removed: **SambaNova** (one-time $5 credit, not renewable; had no
`callProvider` case — the deployed key was dead weight). The voice route's
direct SambaNova call is also gone. **User action: delete `SAMBANOVA_API_KEY`
from Vercel.**

## Infra

| Service | Free-tier cap | Our demand | Notes |
|---|---|---|---|
| Upstash Redis | 500K commands/mo | quote cache ≈ 2-3 cmds/cache event; TTL-bounded ≈ 100K/mo worst case | budgeter itself costs 1-2 cmds/fetch |
| Turso | 500MB / 1B row reads | tiny | |
| Vercel Hobby | 100GB-hr functions, crons | 16 crons + request-time pages | no new crons added in Phase 11 |

## Delay honesty (what the badges mean)

| Source | Label | Reality |
|---|---|---|
| alpaca.iex | LIVE | Real-time but IEX-only ≈ 2-3% of consolidated volume — thin small caps can lag NBBO. Full SIP = $99/mo (rejected) |
| alpaca.options | DELAYED 15m | Indicative OPRA derivative |
| yahoo.futures / .index / .forex | DELAYED 15m | Unofficial API, no SLA; conservative label |
| finnhub.quote / .forex | LIVE (once 11.3 lands) | Real-time on free tier |
| anything >24h old | EOD | e.g. all equities on weekends — honest, not a bug |

**Trading impact of delays:** delayed futures/index quotes are fine for macro
context and dashboards, NOT for signal timing. Real-time decisions should key
off Alpaca IEX equities/ETF proxies only. Options analytics (max pain, GEX)
are positioning measures where 15 minutes is immaterial.
