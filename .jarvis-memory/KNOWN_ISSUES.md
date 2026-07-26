# Known Issues / WIP

Append open items here. Close them out with a strike-through + date when fixed.

---

- **Transformers.js semantic embeddings can't run on Vercel Lambda.**
  Missing native `libonnxruntime.so.1.14.0`. WASM backend hint
  (`env.backends.onnx.wasm.numThreads = 1`) didn't override autodetection.
  Workaround: TF-IDF fallback runs everywhere. Real fix: try Vercel Edge
  runtime, OR swap to `onnxruntime-web` directly, OR move embedding to a
  separate service. See `src/lib/semantic/embed.ts`.

- ~~**Build error at `pnpm run build`** because some routes initialize the~~ **FIXED 2026-07-05 (11.12): lazy `getGroq()` in all three files.** Original note: some routes initialized the
  Groq SDK at module top-level with `process.env.GROQ_API_KEY!`. CI works
  around it by injecting stub env vars. Cleaner fix: lazy-init the SDK
  inside each handler so build-time evaluation doesn't crash.

- **`npm run lint` (`next lint`) is fully broken, not just untuned** — updated
  2026-07-25 (Phase 15): Next.js 16 removed the `next lint` command entirely
  (confirmed in `node_modules/next/dist/docs/01-app/02-guides/upgrading/
  version-16.md`); running it now fails immediately with "Invalid project
  directory provided" instead of linting anything. There's also no
  `eslint.config.*` in the repo, so `eslint .` has nothing to run against
  either. Verified via `tsc --noEmit` + `vitest run` + `next build` instead
  for Phase 15. Real fix: run the `next-lint-to-eslint-cli` codemod
  (`node_modules/next/dist/docs/.../codemods.md`), add a flat ESLint config,
  and repoint the `lint` script + CI at `eslint .`.

- **`domain/mcp-tool-catalog.md` referenced by INDEX.md but the file doesn't
  exist.** The registry smoke test (`registry.test.ts`) is the real catalog
  for now (22 tools after 11.10). Generate the doc from `listTools()` in a
  future step.

- **Vercel Hobby now enforces daily-only crons** — deploys were REJECTED with
  the old sub-daily schedules (`*/15`, `*/30`), which also means intraday
  monitors (drawdown-check, allocation-outcomes, embeddings backfill) have
  likely NOT been running as scheduled on the June-26 production deploy.
  11.11 downgraded them to once-daily so deploys work again. To restore
  intraday cadence for free: point cron-job.org (or similar) at the endpoints
  with `Authorization: Bearer $CRON_SECRET` — they're plain GET routes.
  Or upgrade to Vercel Pro.
