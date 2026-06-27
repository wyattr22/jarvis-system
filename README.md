# Jarvis — Multi-Project Trading Engine

Self-optimizing, multi-agent trading system. Hosts the unified opportunity
feed for splitwatch, swing scanner, and trading_bot. Council of LLM agents
proposes strategy changes; risk-aware allocator decides where capital goes;
voice-controlled dashboard tracks every move.

**Live:** https://jarvis-system-flame.vercel.app

---

## What it does

| Layer | Responsibility |
|-------|----------------|
| **Voice** | Speak to Jarvis ("what's the best opportunity?"). British, dry, terse. |
| **MCP** | Claude Desktop / Claude Code / any HTTP client calls 17 bearer-auth'd tools. |
| **Opportunities** | Unified feed any project pushes ideas into. Approve → allocator → execute. |
| **Allocator** | Kelly-capped sizer + portfolio scorer + Risk Manager veto on every plan. |
| **Council** | Observer mines patterns, Researcher proposes, Critics vote, Meta-agent grades. |
| **Sandbox** | `safeFetch` egress whitelist + per-source quality gate. No surprise web calls. |
| **Memory** | `.jarvis-memory/` markdown — both Claude Code sessions and Jarvis runtime read it. |

---

## Quick start (local dev)

```bash
pnpm install
cp .env.example .env.local
# fill in env vars — minimum: ALPACA_*, GROQ_API_KEY, TURSO_*, CRON_SECRET
pnpm dev
```

Open http://localhost:3000.

## Required env vars

| Var | What | Free? |
|-----|------|-------|
| `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` | Trading | yes (paper) |
| `ALPACA_PAPER` | `"true"` for paper | yes |
| `GROQ_API_KEY` | Primary LLM | yes (rate-limited) |
| `CEREBRAS_API_KEY` | Fast fallback LLM | yes |
| `SAMBANOVA_API_KEY` | Slow fallback LLM | yes |
| `OPENROUTER_API_KEY` | Last-resort LLM | yes (limited models) |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | DB | yes (500MB) |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` | Cache | yes (10K req/day) |
| `CRON_SECRET` | Cron + admin auth | self-set |
| `ALPHA_VANTAGE_KEY` | Economic calendar | yes (5 req/min) |
| `VAPID_*` (3) | Push notifications | yes |
| `ELEVENLABS_API_KEY` | Premium TTS | paid (optional) |

---

## Dashboards

| Path | Group | What |
|------|-------|------|
| `/charts` | market | TradingView widget + zone drawing |
| `/portfolio` | market | Live positions + equity |
| `/news` | market | RSS aggregator (display-only) |
| `/watchlist` | market | Tracked symbols |
| `/memories` | market | Persistent memory CRUD |
| `/bot` | execution | trading_bot signal feed |
| `/backtest` | execution | Strategy backtest runner |
| `/strategies` | execution | Strategy catalog |
| `/features` | execution | Feature engineer output |
| `/drift` | execution | Strategy drift alerts |
| `/source-quality` | execution | Per-source confidence + quarantine |
| `/opportunities` | execution | Cross-project opportunity feed |
| `/allocator` | execution | Run plan, see ranked sizing |
| `/allocations` | execution | Execution history audit |
| `/risk-config` | execution | Edit risk caps |
| `/mcp-clients` | execution | Register + revoke MCP tokens |
| `/system-status` | execution | Cron health + KPI tiles |
| `/proposals` | council | Pending strategy proposals (approve/reject) |
| `/council` | council | Manual council trigger |
| `/meta-decisions` | council | Meta-agent decisions log |
| `/agent-log` | council | Full audit log |
| `/experiments` | council | A/B strategy comparison |

---

## Cron jobs (auto-runs in production)

| Path | Schedule (UTC) | What |
|------|----------------|------|
| `/api/features/compute` | 30 20 * * 1-5 | Feature snapshot per signal |
| `/api/drift/check` | 0 21 * * 1-5 | Drift detector + auto-pause |
| `/api/council/orchestrate` | 0 18 * * 0 | Weekly council cycle (Sundays) |
| `/api/brief/generate` | 0 13 * * 1-5 | Pre-market brief |
| `/api/sync/fills` | 30 21 * * 1-5 | Alpaca fills → trades table |
| `/api/sync/proposal-outcomes` | 0 23 * * * | Approved-proposal P&L delta |
| `/api/sync/meta-enforce` | 0 0 * * * | Apply meta-agent decisions |
| `/api/opportunities/expire` | 0 6 * * * | Mark stale opps expired |
| `/api/sync/allocation-outcomes` | */30 13-21 * * 1-5 | Alpaca order status → allocations |
| `/api/sync/drawdown-check` | */15 13-21 * * 1-5 | Position drawdown alerts |
| `/api/sync/news-scan` | 0 12,16,20 * * 1-5 | RSS → low-confidence opps |

---

## Onboard a new opportunity source

```bash
export CRON_SECRET='...'
./scripts/onboard-external-project.sh /path/to/your-project your-project-name
```

The script:
1. `git init` + `gh repo create` (if not already)
2. Registers an MCP client with `write:opportunities` scope
3. Prints the env vars + curl example to add to your project

Then in your project, POST opportunities to `/api/opportunities/ingest`
with the bearer token.

---

## MCP — connect Claude Desktop

```bash
# Register a token (writes hash to mcp_clients table, returns plaintext ONCE)
curl -X POST https://jarvis-system-flame.vercel.app/api/admin/mcp-clients \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"name":"claude-desktop","scopes":["read:memory","write:memory","read:signals","read:account","read:opportunities","execute:trades"]}'

# In ~/Library/Application Support/Claude/claude_desktop_config.json:
{
  "mcpServers": {
    "jarvis": {
      "command": "npx",
      "args": ["-y", "mcp-remote",
               "https://jarvis-system-flame.vercel.app/api/mcp",
               "--header", "Authorization: Bearer <TOKEN>"]
    }
  }
}
```

Restart Claude Desktop → you'll see the `jarvis` MCP with 17 tools.

---

## Architecture

- **Next.js 16** App Router, deployed on Vercel
- **Turso** (libSQL) for primary data
- **Upstash Redis** for caching
- **Groq / Cerebras / SambaNova / OpenRouter** LLM chain (free tiers)
- **Alpaca** paper trading
- **StreamElements / ElevenLabs** TTS
- **TradingView widget** for charts

See `.jarvis-memory/DECISIONS.md` for architecture decisions (ADR log).
See `.jarvis-memory/CURRENT_PHASE.md` for the live build state.

---

## Development workflow

- One numbered plan step = one branch (`phase-X.Y/short-description`) = one PR.
- Conventional commits enforced via commitlint.
- CI must pass: typecheck + lint + build + vitest.
- Pre-commit hook (`husky` + `lint-staged`) runs typecheck on staged TS.
- Never `--no-verify`. Fix the underlying issue.

Run:
```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm lint        # next lint
pnpm dev         # next dev
pnpm build       # next build
```

---

## Project plan

The full multi-phase plan lives at
`/Users/wyattrantz/.claude/plans/ive-had-an-idea-curried-dawn.md`.

Currently shipped: **Phase 0 through Phase 7.2 (40+ PRs in stack).**

- Phase 0: Workflow + memory system
- Phase 1: MCP foundation (10 tools)
- Phase 2: Opportunities feed + splitwatch/swing tools
- Phase 3: Broker adapters (Alpaca live, futures + forex stubs)
- Phase 4: Risk-aware allocator (sizer, scorer, execute, Risk Mgr veto)
- Phase 5: Voice + Council see opportunities
- Phase 6: Polish — allocator MCP tools, dashboards, news pipeline, drawdown
- Phase 7: System-status, push notifications, README (in flight)
