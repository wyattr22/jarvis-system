// Verifies the sandbox: whitelist allows known hosts, blocks unknown hosts,
// and accepts wildcard suffixes (e.g. *.vercel.app).
//
// This is intentionally the project's FIRST unit test — it proves the
// vitest pipeline works AND it locks down a security-critical surface.

import { describe, it, expect } from "vitest"
import { isAllowedHost } from "./whitelist"

describe("isAllowedHost", () => {
  it("allows core market data hosts", () => {
    expect(isAllowedHost("data.alpaca.markets")).toBe(true)
    expect(isAllowedHost("paper-api.alpaca.markets")).toBe(true)
    expect(isAllowedHost("query1.finance.yahoo.com")).toBe(true)
    expect(isAllowedHost("www.alphavantage.co")).toBe(true)
  })

  it("allows SEC + insider data hosts", () => {
    expect(isAllowedHost("data.sec.gov")).toBe(true)
    expect(isAllowedHost("www.sec.gov")).toBe(true)
  })

  it("allows public sentiment (StockTwits)", () => {
    expect(isAllowedHost("api.stocktwits.com")).toBe(true)
  })

  it("allows LLM compute providers", () => {
    expect(isAllowedHost("api.groq.com")).toBe(true)
    expect(isAllowedHost("api.cerebras.ai")).toBe(true)
    expect(isAllowedHost("api.sambanova.ai")).toBe(false) // removed 2026-07-05 (11.9)
    expect(isAllowedHost("openrouter.ai")).toBe(true)
  })

  it("allows TTS providers", () => {
    expect(isAllowedHost("api.elevenlabs.io")).toBe(true)
    expect(isAllowedHost("api.streamelements.com")).toBe(true)
  })

  it("allows *.vercel.app via wildcard suffix", () => {
    expect(isAllowedHost("jarvis-system-flame.vercel.app")).toBe(true)
    expect(isAllowedHost("preview-abc123.vercel.app")).toBe(true)
  })

  it("blocks arbitrary web hosts", () => {
    expect(isAllowedHost("example.com")).toBe(false)
    expect(isAllowedHost("google.com")).toBe(false)
    expect(isAllowedHost("api.openai.com")).toBe(false)
    expect(isAllowedHost("malicious.example")).toBe(false)
  })

  it("blocks subdomains that don't match a wildcard suffix", () => {
    expect(isAllowedHost("evil.alpaca.markets")).toBe(false)  // not in literal list
    expect(isAllowedHost("data.alpaca.markets.evil.com")).toBe(false)
  })
})
