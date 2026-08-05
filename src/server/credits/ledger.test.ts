import type { SQL } from 'drizzle-orm'
import { CasingCache } from 'drizzle-orm/casing'
import { describe, expect, it, vi } from 'vitest'
import type { Db } from '#/server/db'
import {
  creditsToUsd,
  getSpendGate,
  grantSignup,
  reconcileBalances,
  recordAdjust,
  recordSetCredits,
  recordSpend,
} from './ledger'

/**
 * Spend value sanitation + gate decision mapping (IMA-16 Phase 3). The
 * transactional paths against a real DB are covered by scripts/verify-ledger.ts
 * (run with real money, not in CI). Here we test the pure guards that reject
 * corrupt cost values BEFORE any DB round-trip, and the getSpendGate decision
 * table with a mocked db.execute, both cheap and network-free.
 */

/** A db whose transaction/execute throw proves a call path never reached them. */
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

function renderSql(query: SQL): string {
  return query.toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value}'`,
    casing: new CasingCache(),
  }).sql
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
      // Lock the user before any balance-changing ledger write.
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
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
    // Lock, INSERT, then UPDATE.
    expect(execute).toHaveBeenCalledTimes(3)
    expect(renderSql(execute.mock.calls[0]?.[0] as SQL)).toContain('FOR UPDATE')
  })

  it('returns duplicate (and skips the balance update) on generationId conflict', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      // INSERT ... ON CONFLICT DO NOTHING RETURNING id → zero rows (dup).
      .mockResolvedValueOnce({ rows: [] })
    const db = {
      transaction: async (
        cb: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => cb({ execute }),
    } as unknown as Db

    const result = await recordSpend(db, 7, 0.007, { generationId: 'gen_1' })
    expect(result).toBe('duplicate')
    // The lock and INSERT ran. No balance UPDATE occurs on a duplicate.
    expect(execute).toHaveBeenCalledTimes(2)
  })
})

describe('recordAdjust validation and transaction', () => {
  it('rejects invalid, zero, ceiling, and unreasoned adjustments before the transaction', async () => {
    await expect(
      recordAdjust(forbiddenDb(), 1, '1.000000001', {
        reason: 'fix',
        by: 'test',
      }),
    ).rejects.toThrow(/invalid usd amount/)
    await expect(
      recordAdjust(forbiddenDb(), 1, '0', { reason: 'fix', by: 'test' }),
    ).rejects.toThrow(/zero adjustment/)
    await expect(
      recordAdjust(forbiddenDb(), 1, '25', { reason: 'fix', by: 'test' }),
    ).rejects.toThrow(/sanity ceiling/)
    await expect(
      recordAdjust(forbiddenDb(), 1, '1', { reason: ' ', by: 'test' }),
    ).rejects.toThrow(/non-empty reason/)
  })

  it('locks, appends, and updates in one transaction', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const transaction = vi.fn(
      async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) =>
        cb({ execute }),
    )
    const db = { transaction } as unknown as Db

    await recordAdjust(db, 7, '1.25000000', { reason: 'top-up', by: 'test' })

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(renderSql(execute.mock.calls[0]?.[0] as SQL)).toContain('FOR UPDATE')
  })
})

describe('target setting and reconciliation', () => {
  it('formats whole credits as fixed-point USD without float arithmetic', () => {
    expect(creditsToUsd('0')).toBe('0.00000000')
    expect(creditsToUsd('200')).toBe('1.00000000')
    expect(creditsToUsd('1999999')).toBe('9999.99500000')
    expect(() => creditsToUsd('2000000')).toThrow(/numeric\(12,8\) capacity/)
  })

  it('sets a target only after the locked balance matches its ledger sum', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            ledger_sum: '0.50000000',
            consistent: true,
            delta: '0.50000000',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const transaction = vi.fn(
      async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) =>
        cb({ execute }),
    )
    const db = { transaction } as unknown as Db

    await expect(
      recordSetCredits(db, 7, '200', { reason: 'top-up', by: 'test' }),
    ).resolves.toEqual({
      targetBalanceUsd: '1.00000000',
      ledgerSumUsd: '0.50000000',
      deltaUsd: '0.50000000',
      changed: true,
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(4)
    expect(renderSql(execute.mock.calls[0]?.[0] as SQL)).toContain('FOR UPDATE')
  })

  it('rejects drift without appending an adjustment', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            ledger_sum: '0.50000000',
            consistent: false,
            delta: '0.50000000',
          },
        ],
      })
    const db = {
      transaction: async (
        cb: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => cb({ execute }),
    } as unknown as Db

    await expect(
      recordSetCredits(db, 7, '200', { reason: 'top-up', by: 'test' }),
    ).rejects.toThrow(/balance\/ledger drift/)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('reconciles a zero-ledger user to zero under the writer lock', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 7, email: 'zero@example.com', balance_usd: '0.00000000' }],
      })
    const db = {
      transaction: async (
        cb: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => cb({ execute }),
    } as unknown as Db

    await expect(reconcileBalances(db, 7)).resolves.toEqual([
      { id: 7, email: 'zero@example.com', balance_usd: '0.00000000' },
    ])
    expect(renderSql(execute.mock.calls[0]?.[0] as SQL)).toContain('FOR UPDATE')
    const reconcileSql = renderSql(execute.mock.calls[1]?.[0] as SQL)
    expect(reconcileSql).toContain('COALESCE')
    expect(reconcileSql).toContain('l.user_id = u.id')
  })
})

describe('signup grants', () => {
  it('takes the global capacity lock and ignores negative balances', async () => {
    const originalApiKey = process.env.OPENROUTER_API_KEY
    const originalKvUrl = process.env.KV_REST_API_URL
    const originalKvToken = process.env.KV_REST_API_TOKEN
    process.env.OPENROUTER_API_KEY = 'test-key'
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { total_credits: 20, total_usage: 0 } }),
          { status: 200 },
        ),
      )
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ outstanding: '0.00000000' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
    const db = {
      transaction: async (
        cb: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => cb({ execute }),
    } as unknown as Db

    try {
      await expect(grantSignup(db, 7)).resolves.toBe('granted')
      expect(renderSql(execute.mock.calls[0]?.[0] as SQL)).toContain(
        'pg_advisory_xact_lock',
      )
      expect(renderSql(execute.mock.calls[1]?.[0] as SQL)).toContain(
        'FOR UPDATE',
      )
      expect(renderSql(execute.mock.calls[2]?.[0] as SQL)).toContain('GREATEST')
    } finally {
      fetchMock.mockRestore()
      if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = originalApiKey
      if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL
      else process.env.KV_REST_API_URL = originalKvUrl
      if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN
      else process.env.KV_REST_API_TOKEN = originalKvToken
    }
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

  it('maps granted + positive balance to ok', async () => {
    expect(
      await getSpendGate(dbReturning({ granted: true, positive: true }), 1),
    ).toBe('ok')
  })

  it('maps granted + non-positive balance to empty_wallet', async () => {
    expect(
      await getSpendGate(dbReturning({ granted: true, positive: false }), 1),
    ).toBe('empty_wallet')
  })

  it('maps no grant to waitlisted', async () => {
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
