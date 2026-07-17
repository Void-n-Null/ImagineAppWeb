import { sql } from 'drizzle-orm'
import type { Db } from '#/server/db'
import { fetchPoolRemaining, GRANT_USD, grantAllowed } from './pool'

/**
 * The transactional credit core (IMA-16 Phase 3, design: IMA-DOC-16
 * "Accounting model"). This is REAL MONEY code — every function here runs an
 * interactive Postgres transaction and does ALL balance arithmetic IN SQL
 * (`balance_usd = balance_usd ± $x::numeric`). JavaScript float math never
 * touches a stored value; the only JS numbers are display/threshold values.
 *
 * The ledger is append-only and is the audit source of truth; `users.balance_usd`
 * is the fast-path cache, maintained in the SAME transaction as every ledger
 * insert. Invariant checked by adminStats: `balance_usd == SUM(ledger.usd)`.
 *
 * Idempotency is enforced by the DB, not app logic:
 *  - one grant per user via the unique partial index ledger_user_grant_idx
 *  - one spend per generationId via ledger_spend_generation_idx
 * so the INSERTs use ON CONFLICT DO NOTHING and we branch on rows-affected.
 */

/**
 * A single generation costing more than this is corrupt data, not a real
 * charge (measured heaviest question ≈ $0.007; IMA-16 #455). Reject loudly
 * rather than silently draining a balance on a bad usage payload.
 */
const SPEND_CEILING_USD = 10

export type RecordSpendResult = 'recorded' | 'duplicate'

export interface SpendMeta {
  /** OpenRouter generation id — the dedupe key when present. */
  generationId?: string
  model?: string
  tool?: string
}

/**
 * Record one spend against a user's balance (IMA-16 #360). Transaction:
 *  1. INSERT a negative-usd 'spend' ledger row, ON CONFLICT (generationId)
 *     DO NOTHING — the unique index makes a retried usage report a no-op.
 *  2. If the insert produced a row, UPDATE balance_usd -= cost::numeric in
 *     SQL. On conflict (duplicate generationId) nothing was inserted, so the
 *     balance is left untouched.
 *
 * Spends without a generationId (Exa, voice with no id) can't be deduped by
 * the DB — they fire once per call site by design (see web-search.ts), so the
 * ON CONFLICT clause simply never triggers for them.
 *
 * `usdCost` is a positive USD number; it's converted to a fixed-8dp decimal
 * string and negated for storage. Guards: must be finite, > 0, < $10.
 */
export async function recordSpend(
  db: Db,
  userId: number,
  usdCost: number,
  meta: SpendMeta,
): Promise<RecordSpendResult> {
  if (!Number.isFinite(usdCost) || usdCost <= 0) {
    throw new Error(`recordSpend: invalid usdCost ${usdCost}`)
  }
  if (usdCost >= SPEND_CEILING_USD) {
    // Loud rejection: a >$10 single generation is corrupt data, not a charge.
    throw new Error(
      `recordSpend: usdCost ${usdCost} exceeds sanity ceiling $${SPEND_CEILING_USD}`,
    )
  }

  // Fixed 8dp decimal string (matches numeric(12,8)); negated for the ledger.
  const magnitude = usdCost.toFixed(8)

  return db.transaction(async (tx) => {
    // ON CONFLICT DO NOTHING against ledger_spend_generation_idx. RETURNING id
    // yields zero rows on conflict (duplicate) → no balance change.
    const inserted = await tx.execute(sql`
      INSERT INTO ledger (user_id, kind, usd, meta)
      VALUES (
        ${userId},
        'spend',
        ${`-${magnitude}`}::numeric,
        ${JSON.stringify(meta)}::jsonb
      )
      ON CONFLICT (( meta ->> 'generationId' ))
        WHERE kind = 'spend' AND meta ->> 'generationId' IS NOT NULL
        DO NOTHING
      RETURNING id
    `)

    if (inserted.rows.length === 0) {
      // Duplicate generationId — the row already existed; balance untouched.
      return 'duplicate' as const
    }

    // Debit the fast-path balance in SQL (never JS arithmetic on stored money).
    await tx.execute(sql`
      UPDATE users
      SET balance_usd = balance_usd - ${magnitude}::numeric
      WHERE id = ${userId}
    `)
    return 'recorded' as const
  })
}

export type GrantSignupResult = 'granted' | 'waitlisted' | 'already-granted'

/**
 * Issue the one-time signup grant to a user IF the pool can cover it
 * (IMA-16 #361). Order matters:
 *  1. Read pool remaining (cached ok) OUTSIDE the transaction — it's a network
 *     call and must not hold a DB transaction open.
 *  2. Transaction: SUM all balances as `outstanding`, check the invariant
 *     `grantAllowed(remaining, outstanding)`. If it fails → 'waitlisted', no
 *     writes (the user simply has no grant row and stays in the FIFO queue).
 *  3. Otherwise INSERT the grant row ON CONFLICT DO NOTHING (the unique grant
 *     index). Conflict → someone already granted this user → 'already-granted',
 *     no balance change. Fresh insert → credit the balance += GRANT in SQL →
 *     'granted'.
 *
 * Idempotent by construction: concurrent first-sign-ins race the INSERT, the
 * unique index lets exactly one win, the loser reads 'already-granted'.
 */
export async function grantSignup(
  db: Db,
  userId: number,
): Promise<GrantSignupResult> {
  // If the pool balance can't be read, we can't safely grant — treat as
  // un-grantable (the user waits; syncPool will retry later). fetchPoolRemaining
  // throws only when the key is unset; a network failure also lands here.
  let remaining: number
  try {
    remaining = await fetchPoolRemaining()
  } catch (err) {
    console.warn('[credits] grantSignup: pool read failed, waitlisting:', err)
    return 'waitlisted'
  }

  return db.transaction(async (tx) => {
    // Outstanding = total unspent grant liability across all users.
    const outstandingRes = await tx.execute<{ outstanding: string }>(sql`
      SELECT COALESCE(SUM(balance_usd), 0)::text AS outstanding FROM users
    `)
    const outstanding = Number(outstandingRes.rows[0]?.outstanding ?? '0')

    if (!grantAllowed(remaining, outstanding)) {
      // Pool can't cover another grant + margin — leave the user grant-less
      // (that IS the waitlist state) and write nothing.
      return 'waitlisted' as const
    }

    // One grant per user, enforced by ledger_user_grant_idx. Conflict = the
    // user already has a grant (racing sign-in or a prior sync).
    const inserted = await tx.execute(sql`
      INSERT INTO ledger (user_id, kind, usd, meta)
      VALUES (
        ${userId},
        'grant',
        ${GRANT_USD}::numeric,
        ${JSON.stringify({ reason: 'signup' })}::jsonb
      )
      ON CONFLICT (user_id) WHERE kind = 'grant'
        DO NOTHING
      RETURNING id
    `)

    if (inserted.rows.length === 0) {
      return 'already-granted' as const
    }

    await tx.execute(sql`
      UPDATE users
      SET balance_usd = balance_usd + ${GRANT_USD}::numeric
      WHERE id = ${userId}
    `)
    return 'granted' as const
  })
}

export interface BalanceState {
  /** numeric(12,8) as a string — never parse for arithmetic, only display. */
  balanceUsd: string
  /** Display credits: floor(balanceUsd / 0.005). */
  credits: number
  /** True iff the user has a grant ledger row (i.e. is not waitlisted). */
  granted: boolean
}

/**
 * Balance + grant status in one query. `credits` is computed in SQL (floor of
 * balance/0.005) so the display value never depends on JS float parsing of the
 * numeric string.
 */
export async function getBalanceState(
  db: Db,
  userId: number,
): Promise<BalanceState> {
  const res = await db.execute<{
    balance_usd: string
    credits: number
    granted: boolean
  }>(sql`
    SELECT
      u.balance_usd::text AS balance_usd,
      FLOOR(u.balance_usd / 0.005)::int AS credits,
      EXISTS (
        SELECT 1 FROM ledger g
        WHERE g.user_id = u.id AND g.kind = 'grant'
      ) AS granted
    FROM users u
    WHERE u.id = ${userId}
  `)
  const row = res.rows[0]
  if (!row) {
    // No user row — treat as an empty, ungranted wallet.
    return { balanceUsd: '0', credits: 0, granted: false }
  }
  return {
    balanceUsd: row.balance_usd,
    credits: Number(row.credits),
    granted: row.granted,
  }
}

export type SpendGate = 'ok' | 'empty_wallet' | 'waitlisted'

/**
 * The spend gate for turn/voice entrypoints (IMA-DOC-16 spend policy):
 *  - granted && balance > 0  → 'ok' (turn may start; mid-turn overshoot ok)
 *  - granted && balance <= 0 → 'empty_wallet' (out of credits)
 *  - no grant                → 'waitlisted'
 * The balance comparison is done in SQL so no JS float parse gates real money.
 */
export async function getSpendGate(db: Db, userId: number): Promise<SpendGate> {
  const res = await db.execute<{
    granted: boolean
    positive: boolean
  }>(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM ledger g
        WHERE g.user_id = u.id AND g.kind = 'grant'
      ) AS granted,
      (u.balance_usd > 0) AS positive
    FROM users u
    WHERE u.id = ${userId}
  `)
  const row = res.rows[0]
  if (!row || !row.granted) return 'waitlisted'
  return row.positive ? 'ok' : 'empty_wallet'
}
