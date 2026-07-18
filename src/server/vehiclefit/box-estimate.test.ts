import { describe, expect, it } from 'vitest'
import { estimateTvBox } from './box-estimate'

describe('estimateTvBox', () => {
  it('parses panel dimensions expressed in inches', () => {
    expect(
      estimateTvBox({
        width: '56.9 inches',
        height: '32.4 inches',
        depth: '1.1 inches',
      }),
    ).toEqual({
      box: { w: 62.9, h: 39.4, d: 9 },
      tolerance: { w: 2, h: 2, d: 2 },
    })
  })

  it('accepts quote-suffixed dimensions and prioritizes height without stand', () => {
    expect(
      estimateTvBox({
        width: '48.4"',
        height: '30 inches',
        depth: null,
        details: { 'Height Without Stand': '27.9 inches' },
      }),
    ).toEqual({
      box: { w: 54.4, h: 34.9, d: 9 },
      tolerance: { w: 2, h: 2, d: 2 },
    })
  })

  it('derives a 16:9 panel height with widened uncertainty when height is missing', () => {
    const estimate = estimateTvBox({
      width: '56.9 inches',
      height: null,
      depth: null,
    })

    expect(estimate?.box.w).toBe(62.9)
    expect(estimate?.box.h).toBeCloseTo(40.00625)
    expect(estimate?.tolerance).toEqual({ w: 2, h: 3, d: 2 })
  })

  it('returns null when panel width cannot be parsed', () => {
    expect(
      estimateTvBox({ width: 'very wide', height: '30 inches', depth: null }),
    ).toBeNull()
  })
})
