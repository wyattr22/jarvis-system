import { describe, it, expect } from "vitest"
import { heatCellStyle } from "./sector-heatmap"

describe("heatCellStyle", () => {
  it("uses the neutral surface near zero", () => {
    expect(heatCellStyle(0).background).toBe("#111827")
    expect(heatCellStyle(0.05).background).toBe("#111827")
  })

  it("uses the green pole for gains and red pole for losses", () => {
    expect(heatCellStyle(1).background).toContain("0, 163, 125")
    expect(heatCellStyle(-1).background).toContain("230, 69, 69")
  })

  it("saturates at ±2%", () => {
    expect(heatCellStyle(2).background).toBe(heatCellStyle(9).background)
    expect(heatCellStyle(-2).background).toBe(heatCellStyle(-9).background)
  })

  it("scales alpha with magnitude", () => {
    const weak = heatCellStyle(0.5).background.match(/([\d.]+)\)$/)![1]
    const strong = heatCellStyle(1.5).background.match(/([\d.]+)\)$/)![1]
    expect(Number(strong)).toBeGreaterThan(Number(weak))
  })
})
