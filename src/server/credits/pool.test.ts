import { describe, expect, it } from 'vitest'
import {
  CREDIT_USD,
  GRANT_USD,
  GRANT_USD_NUM,
  grantAllowed,
  MARGIN_USD,
} from './pool'

/**
 * The pool grant invariant (IMA-16 Phase 3, IMA-DOC-16):
 *   grant allowed iff remaining − outstanding − MARGIN ($1.00) ≥ GRANT ($0.50)
 * Tested at, just below, and above the threshold. Pure math — no network.
 */

describe('constants', () => {
  it('match the design doc (IMA-DOC-16)', () => {
    expect(GRANT_USD).toBe('0.50')
    expect(GRANT_USD_NUM).toBe(0.5)
    expect(MARGIN_USD).toBe(1.0)
    expect(CREDIT_USD).toBe(0.005)
  })
})

describe('grantAllowed', () => {
  it('allows a grant exactly at the margin threshold', () => {
    // remaining − outstanding = MARGIN + GRANT = 1.50 exactly → allowed (≥).
    expect(grantAllowed(1.5, 0)).toBe(true)
    expect(grantAllowed(11.5, 10)).toBe(true)
  })

  it('rejects a grant just below the threshold', () => {
    // A hair under 1.50 of headroom → not allowed.
    expect(grantAllowed(1.49, 0)).toBe(false)
    expect(grantAllowed(11.49, 10)).toBe(false)
  })

  it('allows a grant comfortably above the threshold', () => {
    expect(grantAllowed(20, 0)).toBe(true)
    expect(grantAllowed(20, 5)).toBe(true)
  })

  it('rejects when outstanding liability eats the pool', () => {
    // Pool has $2 but $1 is already promised → only $1 free < $1.50 needed.
    expect(grantAllowed(2, 1)).toBe(false)
  })

  it('rejects an empty or negative pool', () => {
    expect(grantAllowed(0, 0)).toBe(false)
    expect(grantAllowed(-5, 0)).toBe(false)
  })

  it('models the $20 pool funding ~12 more grants at $0.50 outstanding-free', () => {
    // Fresh $20 pool, nothing outstanding: 20 − 0 − 1 = 19 ≥ 0.5 → allowed.
    expect(grantAllowed(20, 0)).toBe(true)
    // After ~37 grants outstanding ($18.50): 20 − 18.5 − 1 = 0.5 ≥ 0.5 → allowed.
    expect(grantAllowed(20, 18.5)).toBe(true)
    // One more ($19.00 outstanding): 20 − 19 − 1 = 0 < 0.5 → waitlist.
    expect(grantAllowed(20, 19)).toBe(false)
  })
})
