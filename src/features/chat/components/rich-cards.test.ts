import { describe, expect, it } from 'vitest'
import { crossSectionTiltDegrees } from './rich-cards'

const equinox = { boxH: 40, boxD: 9, openW: 43, openH: 30 }

describe('crossSectionTiltDegrees', () => {
  it('is 0 for upright and none, 90 for flat', () => {
    expect(
      crossSectionTiltDegrees({ recommended: 'upright', ...equinox }),
    ).toBe(0)
    expect(crossSectionTiltDegrees({ recommended: 'none', ...equinox })).toBe(0)
    expect(crossSectionTiltDegrees({ recommended: 'flat', ...equinox })).toBe(
      90,
    )
  })

  it('solves the smallest feasible lean for the tilted orientation', () => {
    const degrees = crossSectionTiltDegrees({
      recommended: 'tilted',
      ...equinox,
    })
    // 40x9 cross-section through a 43x30 aperture needs a heavy lean.
    expect(degrees).toBe(56)
    const radians = (degrees * Math.PI) / 180
    const width = 9 * Math.cos(radians) + 40 * Math.sin(radians)
    const height = 9 * Math.sin(radians) + 40 * Math.cos(radians)
    expect(width).toBeLessThanOrEqual(43)
    expect(height).toBeLessThanOrEqual(30)
  })

  it('keeps a small cross-section upright when no lean is needed', () => {
    expect(
      crossSectionTiltDegrees({
        recommended: 'tilted',
        boxH: 24,
        boxD: 8,
        openW: 43,
        openH: 30,
      }),
    ).toBe(0)
  })

  it('returns 0 (honest overflow) when no rotation can fit', () => {
    expect(
      crossSectionTiltDegrees({
        recommended: 'tilted',
        boxH: 60,
        boxD: 20,
        openW: 25,
        openH: 22,
      }),
    ).toBe(0)
  })
})
