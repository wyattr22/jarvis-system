// Smoke test for the news pipeline shape.

import { describe, it, expect } from "vitest"
import { NEWS_CONFIDENCE_FLOOR } from "./news-to-opportunities"

describe("NEWS_CONFIDENCE_FLOOR", () => {
  it("stays below the 0.5 model gate so news never enters LLM context", () => {
    expect(NEWS_CONFIDENCE_FLOOR).toBeLessThan(0.5)
  })

  it("stays > 0 so the rows still pass schema validation", () => {
    expect(NEWS_CONFIDENCE_FLOOR).toBeGreaterThan(0)
  })
})
