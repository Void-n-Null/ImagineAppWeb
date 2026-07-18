import { describe, expect, it } from 'vitest'
import { computeFit, type ComputeFitInput, FIT_SAMPLE_COUNT } from './geometry'

function crvCargo() {
  return {
    cargoLengthIn: 55.1,
    openingWidthIn: 42,
    openingHeightIn: 31,
  }
}

describe('computeFit', () => {
  it('is deterministic for a seed', () => {
    const input: ComputeFitInput = {
      box: { w: 62, h: 41, d: 9 },
      tolerance: { w: 2, h: 2, d: 2 },
      cargo: crvCargo(),
      seed: 90210,
    }

    expect(computeFit(input)).toEqual(computeFit(input))
  })

  it('finds a viable diagonal load for the 65-inch box and CR-V fixture', () => {
    const result = computeFit({
      box: { w: 62, h: 41, d: 9 },
      tolerance: { w: 2, h: 2, d: 2 },
      cargo: crvCargo(),
      seed: 7,
    })

    expect(result.pAny).toBeGreaterThan(0.5)
    expect(Math.max(result.pTilted, result.pFlat)).toBeGreaterThan(0)
    expect(result.samples).toBe(FIT_SAMPLE_COUNT)
  })

  it('rejects a 77-inch box at a compact-sedan trunk opening', () => {
    const result = computeFit({
      box: { w: 72, h: 46, d: 10 },
      tolerance: { w: 0, h: 0, d: 0 },
      cargo: {
        cargoLengthIn: 40,
        openingWidthIn: 40,
        openingHeightIn: 18,
      },
      seed: 8,
    })

    expect(result.pAny).toBeLessThan(0.05)
    expect(result.recommended).toBe('none')
  })

  it('finds upright placement for a 43-inch box and CR-V fixture', () => {
    const result = computeFit({
      box: { w: 44, h: 29, d: 8 },
      tolerance: { w: 2, h: 2, d: 2 },
      cargo: crvCargo(),
      seed: 9,
    })

    expect(result.pUpright).toBeGreaterThan(0.5)
  })

  it('caps confidence at 80% when the worst-case margin check fails', () => {
    // 65-inch box in the CR-V fixture: samples overwhelmingly fit tilted,
    // but a +2 in box against a -2 in cargo area does not.
    const result = computeFit({
      box: { w: 62, h: 41, d: 9 },
      tolerance: { w: 2, h: 2, d: 2 },
      cargo: crvCargo(),
      seed: 7,
    })

    expect(result.worstCaseFit).toBe(false)
    expect(result.pAny).toBeLessThanOrEqual(0.8)
  })

  it('keeps full confidence when the worst-case margin check passes', () => {
    const result = computeFit({
      box: { w: 44, h: 29, d: 8 },
      tolerance: { w: 2, h: 2, d: 2 },
      cargo: crvCargo(),
      seed: 9,
    })

    expect(result.worstCaseFit).toBe(true)
  })

  it('produces only exact zero-or-one probabilities without tolerances', () => {
    const result = computeFit({
      box: { w: 44, h: 29, d: 8 },
      tolerance: { w: 0, h: 0, d: 0 },
      cargo: {
        ...crvCargo(),
        tolerance: {
          cargoLength: 0,
          openingWidth: 0,
          openingHeight: 0,
        },
      },
      seed: 10,
    })

    expect([result.pUpright, result.pTilted, result.pFlat, result.pAny]).toEqual(
      [1, 1, 1, 1],
    )
  })
})
