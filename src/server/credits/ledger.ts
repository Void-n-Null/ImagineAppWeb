import { sql } from 'drizzle-orm'
import type { Db } from '#/server/db'
import { fetchPoolRemaining, GRANT_USD, grantAllowed } from './pool'

/**
 * The transactional credit core (IMA-16 Phase 3, design: IMA-DOC-16
 * "Accounting model"). This is REAL MONEY code. Every function here runs an
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
  /** OpenRouter generation id, the dedupe key when present. */
  generationId?: string
  model?: string
  tool?: string
}

type CreditTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Every ledger writer obtains this row lock before appending its ledger row.
 * Admin reconciliation and target-setting take the same lock, so their ledger
 * reads cannot observe an in-flight write without its corresponding balance
 * update.
 */
async function lockUser(tx: CreditTransaction, userId: number): Promise<void> {
  const locked = await tx.execute<{ id: number }>(sql`
    SELECT id FROM users WHERE id = ${userId} FOR UPDATE
  `)
  if (!locked.rows[0]) {
    throw new Error(`credits: user ${userId} not found`)
  }
}

/**
 * Record one spend against a user's balance (IMA-16 #360). Transaction:
 *  1. Lock the user row, then INSERT a negative-usd 'spend' ledger row, ON
 *     CONFLICT (generationId) DO NOTHING. The unique index makes a retried
 *     usage report a no-op.
 *  2. If the insert produced a row, UPDATE balance_usd -= cost::numeric in
 *     SQL. On conflict (duplicate generationId) nothing was inserted, so the
 *     balance is left untouched.
 *
 * Spends without a generationId (Exa, voice with no id) can't be deduped by
 * the DB. They fire once per call site by design (see web-search.ts), so the
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
    await lockUser(tx, userId)

    // ON CONFLICT DO NOTHING against ledger_spend_generation_idx. RETURNING id
    // yields zero rows on conflict (duplicate), so there is no balance change.
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
      // Duplicate generationId, the row already existed; balance untouched.
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

/**
 * A single manual adjustment larger than this is almost certainly a typo'd
 * amount (the whole pool is single-digit dollars). Reject loudly.
 */
const ADJUST_CEILING_USD = 25

/** Signed fixed-point decimal, up to 8dp, matching numeric(12,8). */
const SIGNED_DECIMAL_RE = /^-?\d{1,4}(\.\d{1,8})?$/

export interface AdjustMeta {
  /** Why this adjustment exists, required for the audit trail. */
  reason: string
  /** Who performed it (e.g. 'blake via credits CLI'). */
  by: string
  [key: string]: unknown
}

function validateAdjustment(usdDelta: string, meta: AdjustMeta): void {
  if (!SIGNED_DECIMAL_RE.test(usdDelta)) {
    throw new Error(
      `recordAdjust: invalid usd amount ${JSON.stringify(usdDelta)}`,
    )
  }
  // Number() here is for threshold comparison only, never stored.
  const magnitude = Math.abs(Number(usdDelta))
  if (magnitude === 0) {
    throw new Error('recordAdjust: zero adjustment is a no-op, refusing')
  }
  if (magnitude >= ADJUST_CEILING_USD) {
    throw new Error(
      `recordAdjust: |${usdDelta}| exceeds sanity ceiling $${ADJUST_CEILING_USD}`,
    )
  }
  if (!meta.reason?.trim()) {
    throw new Error('recordAdjust: a non-empty reason is required')
  }
}

async function appendAdjustment(
  tx: CreditTransaction,
  userId: number,
  usdDelta: string,
  meta: AdjustMeta,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO ledger (user_id, kind, usd, meta)
    VALUES (
      ${userId},
      'adjust',
      ${usdDelta}::numeric,
      ${JSON.stringify(meta)}::jsonb
    )
  `)
  await tx.execute(sql`
    UPDATE users
    SET balance_usd = balance_usd + ${usdDelta}::numeric
    WHERE id = ${userId}
  `)
}

/**
 * Record one manual balance adjustment (admin top-up / correction). The amount
 * is a SIGNED DECIMAL STRING (e.g. '1.00446107' or '-0.25') inserted into the
 * numeric column verbatim. JavaScript float math never touches it, matching the
 * GRANT_USD idiom. Transaction: append the 'adjust' ledger row AND move the
 * fast-path balance together, preserving the balance_usd == SUM(ledger.usd)
 * invariant. Unlike grants/spends there is no idempotency key: every call
 * appends a row, so callers (the credits CLI) must not retry blindly.
 */
export async function recordAdjust(
  db: Db,
  userId: number,
  usdDelta: string,
  meta: AdjustMeta,
): Promise<void> {
  validateAdjustment(usdDelta, meta)

  await db.transaction(async (tx) => {
    await lockUser(tx, userId)
    await appendAdjustment(tx, userId, usdDelta, meta)
  })
}

const CREDIT_USD_SCALED = 500_000n
const NUMERIC_SCALE = 100_000_000n
const MAX_BALANCE_SCALED = 999_999_999_999n
const CREDITS_RE = /^\d+$/

/** Convert a non-negative whole credit count to a fixed-8dp USD string. */
export function creditsToUsd(credits: string): string {
  if (!CREDITS_RE.test(credits)) {
    throw new Error(
      `recordSetCredits: invalid credit target ${JSON.stringify(credits)}`,
    )
  }
  const scaled = BigInt(credits) * CREDIT_USD_SCALED
  if (scaled > MAX_BALANCE_SCALED) {
    throw new Error('recordSetCredits: target exceeds numeric(12,8) capacity')
  }
  const whole = scaled / NUMERIC_SCALE
  const fraction = (scaled % NUMERIC_SCALE).toString().padStart(8, '0')
  return `${whole}.${fraction}`
}

export interface SetCreditsResult {
  targetBalanceUsd: string
  ledgerSumUsd: string
  deltaUsd: string
  changed: boolean
}

/**
 * Set a user's displayed-credit target atomically. The user row is locked
 * before reading the ledger, matching every ledger writer's lock order. A
 * pre-existing balance/ledger mismatch is rejected rather than hidden by a
 * target adjustment, so an operator must reconcile it explicitly first.
 */
export async function recordSetCredits(
  db: Db,
  userId: number,
  credits: string,
  meta: AdjustMeta,
): Promise<SetCreditsResult> {
  const targetBalanceUsd = creditsToUsd(credits)

  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const state = await tx.execute<{
      ledger_sum: string
      consistent: boolean
      delta: string
    }>(sql`
      SELECT
        COALESCE(SUM(l.usd), 0)::numeric(12, 8)::text AS ledger_sum,
        (u.balance_usd = COALESCE(SUM(l.usd), 0)) AS consistent,
        (${targetBalanceUsd}::numeric - COALESCE(SUM(l.usd), 0))::numeric(12, 8)::text AS delta
      FROM users u
      LEFT JOIN ledger l ON l.user_id = u.id
      WHERE u.id = ${userId}
      GROUP BY u.id, u.balance_usd
    `)
    const current = state.rows[0]
    if (!current) {
      throw new Error(
        `recordSetCredits: user ${userId} disappeared while locked`,
      )
    }
    if (!current.consistent) {
      throw new Error(
        `recordSetCredits: user ${userId} has balance/ledger drift; reconcile before setting a target`,
      )
    }
    if (Number(current.delta) === 0) {
      return {
        targetBalanceUsd,
        ledgerSumUsd: current.ledger_sum,
        deltaUsd: current.delta,
        changed: false,
      }
    }

    validateAdjustment(current.delta, meta)
    await appendAdjustment(tx, userId, current.delta, meta)
    return {
      targetBalanceUsd,
      ledgerSumUsd: current.ledger_sum,
      deltaUsd: current.delta,
      changed: true,
    }
  })
}

export interface ReconciledBalance {
  id: number
  email: string | null
  balance_usd: string
}

/**
 * Repair materialized balances from the ledger under the same per-user locks
 * that ledger writers take. The correlated, coalesced sum intentionally maps a
 * user with no ledger rows to zero.
 */
export async function reconcileBalances(
  db: Db,
  userId?: number,
): Promise<ReconciledBalance[]> {
  const lockFilter = userId === undefined ? sql`` : sql`WHERE id = ${userId}`
  const userFilter = userId === undefined ? sql`` : sql`AND u.id = ${userId}`

  return db.transaction(async (tx) => {
    // Separate statements are intentional. At READ COMMITTED the UPDATE gets a
    // fresh snapshot after this lock waits for any prior ledger writer.
    await tx.execute(sql`
      SELECT id FROM users ${lockFilter} ORDER BY id FOR UPDATE
    `)
    const reconciled = await tx.execute<
      ReconciledBalance & Record<string, unknown>
    >(sql`
      UPDATE users u
      SET balance_usd = COALESCE(
        (SELECT SUM(l.usd) FROM ledger l WHERE l.user_id = u.id),
        0
      )
      WHERE u.balance_usd IS DISTINCT FROM COALESCE(
        (SELECT SUM(l.usd) FROM ledger l WHERE l.user_id = u.id),
        0
      )
      ${userFilter}
      RETURNING u.id, u.email, u.balance_usd::text AS balance_usd
    `)
    return reconciled.rows
  })
}

export type GrantSignupResult = 'granted' | 'waitlisted' | 'already-granted'

/**
 * Issue the one-time signup grant to a user IF the pool can cover it
 * (IMA-16 #361). Order matters:
 *  1. Read pool remaining (cached ok) outside the transaction. It is a network
 *     call and must not hold a DB transaction open.
 *  2. Transaction: SUM all balances as `outstanding`, check the invariant
 *     `grantAllowed(remaining, outstanding)`. If it fails, return 'waitlisted', no
 *     writes (the user simply has no grant row and stays in the FIFO queue).
 *  3. Otherwise INSERT the grant row ON CONFLICT DO NOTHING (the unique grant
 *     index). Conflict means someone already granted this user, so return
 *     'already-granted' with no balance change. A fresh insert credits the
 *     balance += GRANT in SQL and returns
 *     'granted'.
 *
 * Idempotent by construction: concurrent first-sign-ins race the INSERT, the
 * unique index lets exactly one win, the loser reads 'already-granted'.
 */
export async function grantSignup(
  db: Db,
  userId: number,
): Promise<GrantSignupResult> {
  // If the pool balance can't be read, we can't safely grant. Treat it as
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
    // Serialize the shared pool-capacity check across different users. The
    // per-user row lock below only protects one wallet, not the global limit.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(491311, 1)`)
    await lockUser(tx, userId)

    // Outstanding = total unspent grant liability across all users.
    const outstandingRes = await tx.execute<{ outstanding: string }>(sql`
      SELECT COALESCE(SUM(GREATEST(balance_usd, 0)), 0)::text AS outstanding
      FROM users
    `)
    const outstanding = Number(outstandingRes.rows[0]?.outstanding ?? '0')

    if (!grantAllowed(remaining, outstanding)) {
      // Pool can't cover another grant + margin. Leave the user grant-less
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
  /** numeric(12,8) as a string, never parse for arithmetic, only display. */
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
    // No user row, treat as an empty, ungranted wallet.
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
