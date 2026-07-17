/**
 * Ledger integrity smoke test against the REAL dev DB (IMA-16 Phase 3).
 *
 * NOT a vitest test — this hits Neon and is meant to be run by hand with
 * .env.local sourced:
 *
 *     set -a; source .env.local; set +a
 *     bun scripts/verify-ledger.ts
 *
 * It creates a scratch user, records a grant + three spends (one with a
 * DUPLICATED generationId to prove the idempotency index), asserts the
 * fast-path balance equals SUM(ledger.usd), prints a table, and deletes the
 * scratch rows on the way out (even on failure). It never touches real users.
 *
 * Guard: refuses to run unless DATABASE_URL is set.
 */

import process from 'node:process'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { recordSpend } from '#/server/credits/ledger'
import * as schema from '#/server/db/schema'

if (typeof WebSocket !== 'undefined') {
  neonConfig.webSocketConstructor = WebSocket
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`)
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      'DATABASE_URL is not set. Run: set -a; source .env.local; set +a',
    )
    process.exit(1)
  }

  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool, { schema })
  const raw = await pool.connect()

  let userId: number | undefined
  try {
    // Scratch user — clerk id namespaced so it can never collide with a real one.
    const clerkId = `__verify_ledger__${Date.now()}`
    const ins = await raw.query<{ id: number }>(
      'INSERT INTO users (clerk_user_id, email) VALUES ($1, $2) RETURNING id',
      [clerkId, 'verify-ledger@example.invalid'],
    )
    userId = ins.rows[0]?.id
    assert(typeof userId === 'number', 'scratch user was created')
    console.log(`Created scratch user id=${userId}`)

    // 1) Grant $0.50 directly (mirrors grantSignup's ledger+balance shape).
    await raw.query('BEGIN')
    await raw.query(
      "INSERT INTO ledger (user_id, kind, usd, meta) VALUES ($1, 'grant', $2::numeric, $3::jsonb)",
      [userId, '0.50', JSON.stringify({ reason: 'signup' })],
    )
    await raw.query(
      'UPDATE users SET balance_usd = balance_usd + $1::numeric WHERE id = $2',
      ['0.50', userId],
    )
    await raw.query('COMMIT')

    // 2) Three spends through the REAL recordSpend transaction. The second and
    //    third share a generationId to prove the unique index dedupes.
    const r1 = await recordSpend(db, userId, 0.007, {
      tool: 'web_search',
    })
    const r2 = await recordSpend(db, userId, 0.0021, {
      model: 'google/gemini-3.1-flash-lite',
      generationId: 'verify_gen_A',
    })
    const r3dup = await recordSpend(db, userId, 0.0021, {
      model: 'google/gemini-3.1-flash-lite',
      generationId: 'verify_gen_A', // same id → must dedupe
    })

    console.log(
      `Spend results: web_search=${r1}, genA=${r2}, genA(dup)=${r3dup}`,
    )
    assert(r1 === 'recorded', 'first spend recorded')
    assert(r2 === 'recorded', 'second spend (genA) recorded')
    assert(r3dup === 'duplicate', 'duplicate genA spend deduped (idempotent)')

    // 3) Invariant: fast-path balance == SUM(ledger.usd), compared in SQL.
    const check = await raw.query<{
      balance_usd: string
      ledger_sum: string
      equal: boolean
    }>(
      `SELECT u.balance_usd::text AS balance_usd,
              COALESCE(l.sum, 0)::text AS ledger_sum,
              (u.balance_usd = COALESCE(l.sum, 0)) AS equal
       FROM users u
       LEFT JOIN (SELECT user_id, SUM(usd) AS sum FROM ledger GROUP BY user_id) l
         ON l.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    )
    const row = check.rows[0]
    assert(row, 'balance/ledger row found')

    // Expected: 0.50 grant − 0.007 − 0.0021 (dup not counted) = 0.4909.
    const expected = '0.49090000'

    const ledgerRows = await raw.query<{
      kind: string
      usd: string
      meta: unknown
    }>(
      'SELECT kind, usd::text AS usd, meta FROM ledger WHERE user_id = $1 ORDER BY id ASC',
      [userId],
    )

    console.log('\nLedger rows:')
    console.table(
      ledgerRows.rows.map((r) => ({
        kind: r.kind,
        usd: r.usd,
        meta: JSON.stringify(r.meta),
      })),
    )
    console.log('\nBalance reconciliation:')
    console.table([
      {
        balance_usd: row.balance_usd,
        ledger_sum: row.ledger_sum,
        equal: row.equal,
        expected,
      },
    ])

    assert(row.equal === true, 'balance_usd == SUM(ledger.usd)')
    assert(
      row.balance_usd === expected,
      `balance ${row.balance_usd} == expected ${expected}`,
    )
    // Exactly 3 ledger rows: 1 grant + 2 spends (the dup never inserted).
    assert(
      ledgerRows.rows.length === 3,
      `3 ledger rows (grant + 2 spends), got ${ledgerRows.rows.length}`,
    )

    console.log('\n✅ ALL ASSERTIONS PASSED — ledger is consistent & idempotent.')
  } finally {
    // Delete scratch rows regardless of outcome (ledger first — FK).
    if (userId !== undefined) {
      await raw.query('DELETE FROM ledger WHERE user_id = $1', [userId])
      await raw.query('DELETE FROM users WHERE id = $1', [userId])
      console.log(`Cleaned up scratch user id=${userId}`)
    }
    raw.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('\n❌ verify-ledger FAILED:', err)
  process.exit(1)
})
