import { sql } from 'drizzle-orm'
import { getDb } from '#/server/db'
import { grantSignup } from './ledger'
import { fetchPoolRemaining } from './pool'

/**
 * Pool sync + admin telemetry (IMA-16 Phase 3, design: IMA-DOC-16 "Top-up
 * flow" / "Pool allocation invariant"). Called when Blake tops up the
 * OpenRouter account: recompute the invariant against a FRESH pool balance
 * and issue grants down the FIFO waitlist until the pool can't cover the next
 * one.
 */

export interface SyncPoolResult {
  granted: number
  waitlisted: number
  remaining: number
  /** SUM(users.balance_usd) after the sync, as a string. */
  outstanding: string
}

/**
 * Issue grants down the waitlist, oldest signup first (IMA-DOC-16 FIFO:
 * users.id ASC IS signup order; the waitlist is users with no grant row).
 *
 * We fetch pool remaining FRESH once (bypassing the 60s cache) so the batch
 * decision uses the just-topped-up balance. Then we walk ungranted users in id
 * order and call grantSignup for each — grantSignup re-reads the (now cached)
 * remaining and re-checks the invariant per user, so as balances grow the
 * invariant tightens and eventually returns 'waitlisted'. We STOP at the first
 * 'waitlisted': everyone behind them in the queue is also unfundable, and FIFO
 * fairness means we don't skip ahead.
 */
export async function syncPool(): Promise<SyncPoolResult> {
  const db = getDb()
  // Fresh read: the whole point of a sync is to see the top-up.
  const remaining = await fetchPoolRemaining({ fresh: true })

  // Snapshot the waitlist in FIFO order. New sign-ins during the loop simply
  // wait for the next sync — this batch is bounded and deterministic.
  const waitlist = await db.execute<{ id: number }>(sql`
    SELECT u.id
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM ledger g WHERE g.user_id = u.id AND g.kind = 'grant'
    )
    ORDER BY u.id ASC
  `)

  let granted = 0
  let waitlisted = 0
  for (const row of waitlist.rows) {
    const result = await grantSignup(db, row.id)
    if (result === 'granted') {
      granted += 1
    } else {
      // 'waitlisted' → pool exhausted; stop (FIFO — don't skip ahead).
      // 'already-granted' → shouldn't happen for a waitlist row, but if a race
      // slipped one in, it's not a fundable grant; treat like exhausted-adjacent
      // and stop conservatively only on 'waitlisted'.
      if (result === 'waitlisted') {
        waitlisted = waitlist.rows.length - granted
        break
      }
    }
  }

  const outstandingRes = await db.execute<{ outstanding: string }>(sql`
    SELECT COALESCE(SUM(balance_usd), 0)::text AS outstanding FROM users
  `)

  return {
    granted,
    waitlisted,
    remaining,
    outstanding: outstandingRes.rows[0]?.outstanding ?? '0',
  }
}

export interface AdminUserRow {
  id: number
  email: string | null
  credits: number
  balanceUsd: string
  granted: boolean
  createdAt: string
}

export interface AdminDriftRow {
  userId: number
  balanceUsd: string
  ledgerSum: string
}

export interface AdminStats {
  remaining: number
  /** SUM(users.balance_usd) — total unspent grant liability. */
  outstanding: string
  /** −SUM(spend usd) — total spent to date (positive USD). */
  spentTotalUsd: string
  grantsIssued: number
  waitlistCount: number
  users: AdminUserRow[]
  /** Users whose fast-path balance != SUM(their ledger) — a reconciliation bug. */
  drift: AdminDriftRow[]
}

/**
 * Full admin snapshot (IMA-16 Phase 3). All aggregates are computed in SQL;
 * `drift` surfaces any user whose fast-path `balance_usd` has diverged from
 * `SUM(ledger.usd)` — the audit invariant. A non-empty drift list means a
 * transaction partially applied or a spend was recorded outside the ledger,
 * and is the signal to investigate (spend-record failures log to console and
 * leave residue here).
 */
export async function adminStats(): Promise<AdminStats> {
  const db = getDb()

  let remaining: number
  try {
    remaining = await fetchPoolRemaining()
  } catch (err) {
    // Admin view should render even if OpenRouter is unreachable; -1 signals
    // "unknown" without crashing the whole stats call.
    console.warn('[credits] adminStats: pool read failed:', err)
    remaining = -1
  }

  const outstandingRes = await db.execute<{ outstanding: string }>(sql`
    SELECT COALESCE(SUM(balance_usd), 0)::text AS outstanding FROM users
  `)

  const spentRes = await db.execute<{ spent: string }>(sql`
    SELECT COALESCE(-SUM(usd), 0)::text AS spent
    FROM ledger WHERE kind = 'spend'
  `)

  const grantsRes = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM ledger WHERE kind = 'grant'
  `)

  const waitlistRes = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM ledger g WHERE g.user_id = u.id AND g.kind = 'grant'
    )
  `)

  const usersRes = await db.execute<{
    id: number
    email: string | null
    credits: number
    balance_usd: string
    granted: boolean
    created_at: string
  }>(sql`
    SELECT
      u.id,
      u.email,
      FLOOR(u.balance_usd / 0.005)::int AS credits,
      u.balance_usd::text AS balance_usd,
      EXISTS (
        SELECT 1 FROM ledger g WHERE g.user_id = u.id AND g.kind = 'grant'
      ) AS granted,
      u.created_at::text AS created_at
    FROM users u
    ORDER BY u.id ASC
  `)

  // Drift: fast-path balance vs. ledger sum, compared in SQL (never JS float).
  const driftRes = await db.execute<{
    user_id: number
    balance_usd: string
    ledger_sum: string
  }>(sql`
    SELECT
      u.id AS user_id,
      u.balance_usd::text AS balance_usd,
      COALESCE(l.sum, 0)::text AS ledger_sum
    FROM users u
    LEFT JOIN (
      SELECT user_id, SUM(usd) AS sum FROM ledger GROUP BY user_id
    ) l ON l.user_id = u.id
    WHERE u.balance_usd <> COALESCE(l.sum, 0)
    ORDER BY u.id ASC
  `)

  return {
    remaining,
    outstanding: outstandingRes.rows[0]?.outstanding ?? '0',
    spentTotalUsd: spentRes.rows[0]?.spent ?? '0',
    grantsIssued: Number(grantsRes.rows[0]?.count ?? 0),
    waitlistCount: Number(waitlistRes.rows[0]?.count ?? 0),
    users: usersRes.rows.map((r) => ({
      id: r.id,
      email: r.email,
      credits: Number(r.credits),
      balanceUsd: r.balance_usd,
      granted: r.granted,
      createdAt: r.created_at,
    })),
    drift: driftRes.rows.map((r) => ({
      userId: r.user_id,
      balanceUsd: r.balance_usd,
      ledgerSum: r.ledger_sum,
    })),
  }
}
