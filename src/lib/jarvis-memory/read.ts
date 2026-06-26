// Read-only access to the .jarvis-memory/ directory.
// Voice route can inject relevant memory markdown into LLM context.
//
// Why server-side: keeps Jarvis grounded in the SAME cross-session memory
// every Claude Code session reads. No write path — memory is updated through
// git commits + PRs, never by the LLM itself.

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const MEMORY_ROOT = path.join(process.cwd(), ".jarvis-memory")
const ALLOWED_FILES = new Set([
  "INDEX.md",
  "CURRENT_PHASE.md",
  "DECISIONS.md",
  "KNOWN_ISSUES.md",
])
const ALLOWED_SUBDIRS = new Set(["phases", "sessions", "domain"])

function isSafeRelativePath(rel: string): boolean {
  // Block ../ traversal + absolute paths
  if (rel.startsWith("/") || rel.includes("..")) return false
  const parts = rel.split("/")
  if (parts.length === 1) return ALLOWED_FILES.has(parts[0])
  if (parts.length === 2) return ALLOWED_SUBDIRS.has(parts[0]) && parts[1].endsWith(".md")
  return false
}

export async function readJarvisMemory(relativePath: string): Promise<string> {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`refused unsafe memory path: ${relativePath}`)
  }
  const full = path.join(MEMORY_ROOT, relativePath)
  return await readFile(full, "utf8")
}

export async function listJarvisMemory(): Promise<string[]> {
  const out: string[] = []
  for (const f of ALLOWED_FILES) {
    try { await readFile(path.join(MEMORY_ROOT, f), "utf8"); out.push(f) } catch { /* missing */ }
  }
  for (const sub of ALLOWED_SUBDIRS) {
    try {
      const files = await readdir(path.join(MEMORY_ROOT, sub))
      for (const f of files) if (f.endsWith(".md")) out.push(`${sub}/${f}`)
    } catch { /* missing */ }
  }
  return out
}

// Convenience: fetch the core context the voice route should always see.
// Trimmed to a sane max so we don't blow up the LLM prompt budget.
export async function getCoreMemoryContext(maxChars = 6000): Promise<string> {
  const wanted = ["CURRENT_PHASE.md", "KNOWN_ISSUES.md"]
  const parts: string[] = []
  for (const f of wanted) {
    try {
      const text = await readJarvisMemory(f)
      parts.push(`## ${f}\n${text.slice(0, 3000)}`)
    } catch { /* skip missing */ }
  }
  return parts.join("\n\n---\n\n").slice(0, maxChars)
}
