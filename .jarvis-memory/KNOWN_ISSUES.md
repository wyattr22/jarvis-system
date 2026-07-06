# Known Issues / WIP

Append open items here. Close them out with a strike-through + date when fixed.

---

- **Transformers.js semantic embeddings can't run on Vercel Lambda.**
  Missing native `libonnxruntime.so.1.14.0`. WASM backend hint
  (`env.backends.onnx.wasm.numThreads = 1`) didn't override autodetection.
  Workaround: TF-IDF fallback runs everywhere. Real fix: try Vercel Edge
  runtime, OR swap to `onnxruntime-web` directly, OR move embedding to a
  separate service. See `src/lib/semantic/embed.ts`.

- **Build error at `pnpm run build`** because some routes initialize the
  Groq SDK at module top-level with `process.env.GROQ_API_KEY!`. CI works
  around it by injecting stub env vars. Cleaner fix: lazy-init the SDK
  inside each handler so build-time evaluation doesn't crash.

- **Lint config not tuned** — `next lint` in CI is currently `|| true`.
  Need a follow-up PR to fix any real issues and flip to hard-fail.

- **`domain/mcp-tool-catalog.md` referenced by INDEX.md but the file doesn't
  exist.** The registry smoke test (`registry.test.ts`) is the real catalog
  for now (22 tools after 11.10). Generate the doc from `listTools()` in a
  future step.
