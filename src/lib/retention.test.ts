import { describe, expect, it } from 'vitest'
import {
  isThreadExpired,
  retentionCutoffMs,
  THREAD_RETENTION_MS,
} from './retention'

/**
 * The 72h retention window is a compliance boundary (BB API ToS), so its exact
 * value and its inclusive-of-live boundary are locked here. `now` is injected
 * everywhere so these are deterministic — no wall-clock flakiness.
 */
describe('THREAD_RETENTION_MS', () => {
  it('is exactly seventy-two (72) hours in milliseconds', () => {
    expect(THREAD_RETENTION_MS).toBe(72 * 60 * 60 * 1000)
    expect(THREAD_RETENTION_MS).toBe(259_200_000)
  })
})

describe('retentionCutoffMs', () => {
  it('is now minus the full window', () => {
    const now = 1_000_000_000_000
    expect(retentionCutoffMs(now)).toBe(now - THREAD_RETENTION_MS)
  })
})

describe('isThreadExpired', () => {
  const now = 1_000_000_000_000

  it('keeps a thread updated just inside the window', () => {
    // One ms shy of 72h old → still retained.
    expect(isThreadExpired(now - THREAD_RETENTION_MS + 1, now)).toBe(false)
  })

  it('expires a thread at exactly 72h (boundary is inclusive of expiry)', () => {
    // Exactly 72h old: the full window has elapsed → expired, matching the
    // server's strict `updated_at < now() - interval` purge.
    expect(isThreadExpired(now - THREAD_RETENTION_MS, now)).toBe(true)
  })

  it('expires a thread past the window', () => {
    expect(isThreadExpired(now - THREAD_RETENTION_MS - 1, now)).toBe(true)
  })

  it('retains a brand-new thread', () => {
    expect(isThreadExpired(now, now)).toBe(false)
  })
})
