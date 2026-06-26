// Unit tests for the MCP server registry + dispatch.
// Transport-free: we test the pure JSON-RPC dispatch with synthetic contexts.

import { describe, it, expect, beforeEach } from "vitest"
import { z, registerTool, listTools, dispatch, _clearRegistryForTesting } from "./server"

beforeEach(() => _clearRegistryForTesting())

describe("registerTool + listTools", () => {
  it("registers and lists tools", () => {
    registerTool({
      name: "echo",
      description: "echoes the input",
      inputSchema: z.object({ msg: z.string() }),
      requiredScope: "read:any",
      handler: async (input: { msg: string }) => ({ echoed: input.msg }),
    })
    expect(listTools().map(t => t.name)).toContain("echo")
  })

  it("refuses duplicate registration", () => {
    registerTool({
      name: "x",
      description: "",
      inputSchema: z.object({}),
      requiredScope: "read:any",
      handler: async () => null,
    })
    expect(() =>
      registerTool({
        name: "x",
        description: "",
        inputSchema: z.object({}),
        requiredScope: "read:any",
        handler: async () => null,
      })
    ).toThrow(/already registered/)
  })
})

describe("dispatch — tools/list", () => {
  it("returns registered tools", async () => {
    registerTool({
      name: "memory.search",
      description: "search memories",
      inputSchema: z.object({ query: z.string() }),
      requiredScope: "read:memory",
      handler: async () => [],
    })
    const res = await dispatch(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { clientId: "test", scopes: ["read:memory"] },
    )
    expect("result" in res).toBe(true)
    if ("result" in res) {
      const tools = (res.result as { tools: { name: string }[] }).tools
      expect(tools.find(t => t.name === "memory.search")).toBeTruthy()
    }
  })
})

describe("dispatch — tools/call", () => {
  it("runs the handler when scope matches", async () => {
    registerTool({
      name: "echo",
      description: "",
      inputSchema: z.object({ msg: z.string() }),
      requiredScope: "read:any",
      handler: async (input: { msg: string }) => ({ echoed: input.msg }),
    })
    const res = await dispatch(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { msg: "hi" } } },
      { clientId: "test", scopes: ["read:any"] },
    )
    expect("result" in res).toBe(true)
  })

  it("rejects when client lacks required scope", async () => {
    registerTool({
      name: "memory.save",
      description: "",
      inputSchema: z.object({ content: z.string() }),
      requiredScope: "write:memory",
      handler: async () => "ok",
    })
    const res = await dispatch(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory.save", arguments: { content: "x" } } },
      { clientId: "test", scopes: ["read:memory"] },
    )
    expect("error" in res).toBe(true)
    if ("error" in res) expect(res.error.message).toMatch(/missing scope/)
  })

  it("accepts wildcard scope `*`", async () => {
    registerTool({
      name: "anything",
      description: "",
      inputSchema: z.object({}),
      requiredScope: "execute:trades",
      handler: async () => "done",
    })
    const res = await dispatch(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "anything", arguments: {} } },
      { clientId: "admin", scopes: ["*"] },
    )
    expect("result" in res).toBe(true)
  })

  it("rejects unknown tool", async () => {
    const res = await dispatch(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } },
      { clientId: "test", scopes: ["*"] },
    )
    expect("error" in res).toBe(true)
    if ("error" in res) expect(res.error.message).toMatch(/unknown tool/)
  })

  it("rejects invalid params via zod schema", async () => {
    registerTool({
      name: "needs_number",
      description: "",
      inputSchema: z.object({ n: z.number() }),
      requiredScope: "read:any",
      handler: async () => null,
    })
    const res = await dispatch(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "needs_number", arguments: { n: "not a number" } } },
      { clientId: "test", scopes: ["read:any"] },
    )
    expect("error" in res).toBe(true)
    if ("error" in res) expect(res.error.message).toMatch(/invalid params/)
  })
})

describe("dispatch — unknown method", () => {
  it("returns -32601", async () => {
    const res = await dispatch(
      { jsonrpc: "2.0", id: 7, method: "something/else" },
      { clientId: "test", scopes: ["*"] },
    )
    expect("error" in res).toBe(true)
    if ("error" in res) {
      expect(res.error.code).toBe(-32601)
      expect(res.error.message).toMatch(/unknown method/)
    }
  })
})
