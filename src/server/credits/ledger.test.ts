import { describe, expect, it, vi } from 'vitest'
import type { Db } from '#/server/db'
import { getSpendGate, recordSpend } from './ledger'

/**
 * Spend value sanitation + gate decision mapping (IMA-16 Phase 3). The
 * transactional paths against a real DB are covered by scripts/verify-ledger.ts
 * (run with real money, not in CI). Here we test the pure guards that reject
 * corrupt cost values BEFORE any DB round-trip, and the getSpendGate decision
 * table with a mocked db.execute — both cheap and network-free.
 */

/** A db whose transaction/execute throw — proves a call path never reached them. */
function forbiddenDb(): Db {
  return {
    transaction: () => {
      throw new Error('transaction must not be called for invalid input')
    },
    execute: () => {
      throw new Error('execute must not be called for invalid input')
    },
  } as unknown as Db
}

describe('recordSpend value sanitation', () => {
  it('rejects NaN cost before touching the DB', async () => {
    await expect(
      recordSpend(forbiddenDb(), 1, Number.NaN, { tool: 't' }),
    ).rejects.toThrow(/invalid usdCost/)
  })

  it('rejects Infinity cost', async () => {
    await expect(
      recordSpend(forbiddenDb(), 1, Number.POSITIVE_INFINITY, { tool: 't' }),
    ).rejects.toThrow(/invalid usdCost/)
  })

  it('rejects zero cost', async () => {
    await expect(
      recordSpend(forbiddenDb(), 1, 0, { tool: 't' }),
    ).rejects.toThrow(/invalid usdCost/)
  })

  it('rejects negative cost', async () => {
    await expect(
      recordSpend(forbiddenDb(), 1, -0.01, { tool: 't' }),
    ).rejects.toThrow(/invalid usdCost/)
  })

  it('rejects a cost at or above the $10 sanity ceiling', async () => {
    await expect(
      recordSpend(forbiddenDb(), 1, 10, { tool: 't' }),
    ).rejects.toThrow(/sanity ceiling/)
    await expect(
      recordSpend(forbiddenDb(), 1, 99, { tool: 't' }),
    ).rejects.toThrow(/sanity ceiling/)
  })

  it('accepts a normal cost and reaches the transaction', async () => {
    // A valid cost must pass the guards and enter db.transaction. We stub the
    // transaction to run the callback against a tx that reports an insert +
    // update, and assert the recorded outcome.
    const execute = vi
      .fn()
      // INSERT ... RETURNING id → one row (fresh spend).
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      // UPDATE balance → no rows array needed.
      .mockResolvedValueOnce({ rows: [] })
    const db = {
      transaction: async (
        cb: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => cb({ execute }),
    } as unknown as Db

    const result = await recordSpend(db, 7, 0.007, {
      tool: 'web_search',
    })
    expect(result).toBe('recorded')
    // INSERT then UPDATE — two execute calls.
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('returns duplicate (and skips the balance update) on generationId conflict', async () => {
    const execute = vi
      .fn()
      // INSERT ... ON CONFLICT DO NOTHING RETURNING id → zero rows (dup).
      .mockResolvedValueOnce({ rows: [] })
    const db = {
      transaction: async (
        cb: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => cb({ execute }),
    } as unknown as Db

    const result = await recordSpend(db, 7, 0.007, { generationId: 'gen_1' })
    expect(result).toBe('duplicate')
    // Only the INSERT ran — no balance UPDATE on a duplicate.
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('getSpendGate decision mapping', () => {
  function dbReturning(
    row: { granted: boolean; positive: boolean } | undefined,
  ): Db {
    return {
      execute: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }),
    } as unknown as Db
  }

  it('maps granted + positive balance → ok', async () => {
    expect(
      await getSpendGate(dbReturning({ granted: true, positive: true }), 1),
    ).toBe('ok')
  })

  it('maps granted + non-positive balance → empty_wallet', async () => {
    expect(
      await getSpendGate(dbReturning({ granted: true, positive: false }), 1),
    ).toBe('empty_wallet')
  })

  it('maps no grant → waitlisted', async () => {
    expect(
      await getSpendGate(dbReturning({ granted: false, positive: false }), 1),
    ).toBe('waitlisted')
    // Even with a (nonsensical) positive balance, no grant means waitlisted.
    expect(
      await getSpendGate(dbReturning({ granted: false, positive: true }), 1),
    ).toBe('waitlisted')
  })

  it('maps a missing user row → waitlisted', async () => {
    expect(await getSpendGate(dbReturning(undefined), 999)).toBe('waitlisted')
  })
})
