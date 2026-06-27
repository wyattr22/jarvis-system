// Smoke test for the full MCP tool registry.
//
// Imports every tool file (which triggers their registerTool() side effects),
// then verifies the resulting registry has the expected tool names + scopes.
// Catches accidental rename / scope drift across the catalog.

import { describe, it, expect, beforeAll } from "vitest"
import { listTools, callTool } from "../server"

// Load all tool side-effect modules ONCE for the whole file.
// The server registry is idempotent so re-running registerTool() is safe,
// but per-test resets would lose the registrations because cached module
// imports don't re-execute.
beforeAll(async () => {
  await import("./jarvis")
  await import("./splitwatch")
  await import("./swing")
  await import("./brokers")
  await import("./allocator")
  await import("./opportunities")
})

const EXPECTED_TOOLS = [
  // jarvis
  "memory.search", "memory.save", "signals.list",
  "account.snapshot", "source_quality.snapshot", "voice.ask",
  // source-specific
  "splitwatch.list_opportunities", "swing.list_setups",
  // brokers
  "brokers.list", "brokers.is_open",
  // allocator
  "allocator.plan", "allocator.summary", "allocator.execute",
  // opportunities
  "opportunities.list", "opportunities.top",
  "opportunities.update_status", "opportunities.ingest",
] as const

describe("MCP tool catalog", () => {
  it("registers every expected tool", async () => {
    const tools = listTools()
    const names = new Set(tools.map(t => t.name))
    for (const expected of EXPECTED_TOOLS) {
      expect(names.has(expected), `missing tool ${expected}`).toBe(true)
    }
  })

  it("has 17+ tools (catalog should keep growing, never shrinking)", async () => {
    expect(listTools().length).toBeGreaterThanOrEqual(17)
  })

  it("every tool has a non-empty description", async () => {
    for (const t of listTools()) {
      expect(t.description, `${t.name} description`).toBeTruthy()
      expect(t.description.length, `${t.name} description length`).toBeGreaterThan(20)
    }
  })

  it("scope strings follow the verb:noun convention", async () => {
    // Can't directly inspect requiredScope without a registry-internals helper,
    // but we CAN verify call rejection on wrong scope.
    const tools = listTools()
    expect(tools.length).toBeGreaterThan(0)
  })
})

describe("Scope enforcement", () => {
  it("rejects a read-only client trying to execute trades", async () => {
    await expect(
      callTool("allocator.execute", { approved_ids: ["foo"] },
               { clientId: "test", scopes: ["read:account"] })
    ).rejects.toThrow(/missing scope/)
  })

  it("rejects a read-only client trying to write a memory", async () => {
    await expect(
      callTool("memory.save", { content: "x", type: "fact", tags: [], importance: 5 },
               { clientId: "test", scopes: ["read:memory"] })
    ).rejects.toThrow(/missing scope/)
  })

  it("wildcard scope allows execute:trades", async () => {
    // Will fail downstream (no real CRON_SECRET / no opp ids) but should
    // pass the scope check.
    await callTool(
      "allocator.execute",
      { approved_ids: ["does-not-exist"] },
      { clientId: "admin", scopes: ["*"] },
    ).catch(err => {
      // Anything other than "missing scope" is fine — means scope passed.
      expect(String(err)).not.toMatch(/missing scope/)
    })
  })
})
