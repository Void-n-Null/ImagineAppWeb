/**
 * Credits admin CLI (see AGENTS.md "Credits admin"). Runs against whatever
 * DATABASE_URL points at, which for this repo's .env.local is production.
 * Bun auto-loads .env.local, so plain `bun run credits ...` works.
 *
 *   bun run credits list
 *   bun run credits show <user>
 *   bun run credits adjust <user> (--usd 1.25 | --credits 200) --reason "why"
 *   bun run credits set-credits <user> <n> --reason "why"
 *   bun run credits reconcile [user]
 *   bun run credits pool
 *
 * <user> resolves by: numeric users.id, exact email, or unique case-insensitive
 * email substring ("blake" works). 1 credit = $0.005; display floors.
 *
 * Money doctrine (src/server/credits/ledger.ts): the ledger is append-only
 * truth, users.balance_usd is a materialized cache maintained in the SAME
 * transaction. This CLI only writes through recordAdjust / reconcile, never
 * add a code path that inserts a ledger row without moving balance_usd.
 */

import process from 'node:process'
import { neonConfig, Pool, type PoolClient } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import {
  reconcileBalances,
  recordAdjust,
  recordSetCredits,
} from '#/server/credits/ledger'
import {
  CREDIT_USD,
  fetchPoolRemaining,
  MARGIN_USD,
} from '#/server/credits/pool'
import * as schema from '#/server/db/schema'

if (typeof WebSocket !== 'undefined') {
  neonConfig.webSocketConstructor = WebSocket
}

class CliError extends Error {}

function fail(message: string): never {
  console.error(message)
  throw new CliError()
}

function usage(): never {
  console.error(`usage:
  bun run credits list
  bun run credits show <user>
  bun run credits adjust <user> (--usd <amount> | --credits <n>) --reason "why"
  bun run credits set-credits <user> <n> --reason "why"
  bun run credits reconcile [user]
  bun run credits pool

<user> = users.id, exact email, or unique email substring (e.g. "blake")`)
  throw new CliError()
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) {
    fail(`--${name} requires a value`)
  }
  return value
}

interface UserRow {
  id: number
  email: string | null
}

async function resolveUser(raw: PoolClient, needle: string): Promise<UserRow> {
  if (/^\d+$/.test(needle)) {
    const res = await raw.query<UserRow>(
      'SELECT id, email FROM users WHERE id = $1',
      [Number(needle)],
    )
    if (res.rows[0]) return res.rows[0]
    fail(`no user with id ${needle}`)
  }
  const exact = await raw.query<UserRow>(
    'SELECT id, email FROM users WHERE lower(email) = lower($1)',
    [needle],
  )
  if (exact.rows[0]) return exact.rows[0]
  const fuzzy = await raw.query<UserRow>(
    "SELECT id, email FROM users WHERE email ILIKE '%' || $1 || '%' ORDER BY id",
    [needle],
  )
  if (fuzzy.rows.length === 1) return fuzzy.rows[0] as UserRow
  if (fuzzy.rows.length === 0) {
    console.error(`no user matching ${JSON.stringify(needle)}`)
  } else {
    fail(
      `ambiguous user ${JSON.stringify(needle)}. Matches: ${fuzzy.rows
        .map((r) => `${r.id}:${r.email}`)
        .join(', ')}`,
    )
  }
  throw new CliError()
}

/** One row of the list/show reconciliation view, all money computed in SQL. */
const OVERVIEW_SQL = `
  SELECT u.id,
         u.email,
         u.balance_usd::text AS balance_usd,
         COALESCE(l.sum, 0)::text AS ledger_sum,
         FLOOR(u.balance_usd / ${CREDIT_USD})::int AS credits,
         (u.balance_usd = COALESCE(l.sum, 0)) AS consistent
  FROM users u
  LEFT JOIN (SELECT user_id, SUM(usd) AS sum FROM ledger GROUP BY user_id) l
    ON l.user_id = u.id`

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (!cmd) usage()

  if (!process.env.DATABASE_URL) {
    fail(
      'DATABASE_URL is not set (bun auto-loads .env.local, is it present?)',
    )
  }

  if (cmd === 'pool') {
    // No DB needed for the OpenRouter read, but outstanding liability is in SQL.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    let raw: PoolClient | undefined
    try {
      raw = await pool.connect()
      const out = await raw.query<{ outstanding: string }>(
        'SELECT COALESCE(SUM(GREATEST(balance_usd, 0)), 0)::text AS outstanding FROM users',
      )
      const outstanding = out.rows[0]?.outstanding ?? '0'
      console.log(`outstanding user liability: $${outstanding}`)
      try {
        const remaining = await fetchPoolRemaining({ fresh: true })
        console.log(`pool remaining (OpenRouter): $${remaining.toFixed(4)}`)
        console.log(
          `grantable headroom (remaining - outstanding - $${MARGIN_USD.toFixed(2)} margin): $${(
            remaining - Number(outstanding) - MARGIN_USD
          ).toFixed(4)}`,
        )
      } catch {
        console.log(
          'pool remaining: unavailable (OPENROUTER_API_KEY not set locally, it is a',
          'sensitive Vercel var; check the OpenRouter dashboard)',
        )
      }
    } finally {
      raw?.release()
      await pool.end()
    }
    return
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })
  let raw: PoolClient | undefined

  try {
    raw = await pool.connect()
    const client = raw

    switch (cmd) {
      case 'list': {
        const res = await client.query(`${OVERVIEW_SQL} ORDER BY u.id`)
        console.table(res.rows)
        const drifted = res.rows.filter((r) => !r.consistent)
        if (drifted.length > 0) {
          console.error(
            `WARNING: ${drifted.length} user(s) have balance_usd != SUM(ledger). Run: bun run credits reconcile`,
          )
          process.exitCode = 2
        }
        break
      }

      case 'show': {
        const needle = args[0] ?? usage()
        const user = await resolveUser(client, needle)
        const overview = await client.query(`${OVERVIEW_SQL} WHERE u.id = $1`, [
          user.id,
        ])
        console.table(overview.rows)
        const rows = await client.query(
          `SELECT id, kind, usd::text AS usd, meta, created_at
           FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 15`,
          [user.id],
        )
        console.log('most recent ledger rows (newest first):')
        console.table(
          rows.rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            usd: r.usd,
            meta: JSON.stringify(r.meta),
            at: r.created_at,
          })),
        )
        break
      }

      case 'adjust':
      case 'set-credits': {
        const needle = args[0] ?? usage()
        const user = await resolveUser(client, needle)
        const reason = flag(args, 'reason')
        if (!reason) {
          fail('--reason is required (it is the audit trail)')
        }

        if (cmd === 'set-credits') {
          const target = args[1]
          if (!target || !/^\d+$/.test(target)) usage()
          console.log(
            `setting user ${user.id} (${user.email}) to ${target} credits: "${reason}"`,
          )
          const result = await recordSetCredits(db, user.id, target, {
            reason,
            by: 'credits CLI',
          })
          if (result.changed) {
            console.log(`applied adjustment of $${result.deltaUsd}`)
          } else {
            console.log('target already matches the ledger balance')
          }
        } else {
          const usd = flag(args, 'usd')
          const credits = flag(args, 'credits')
          if ((usd === undefined) === (credits === undefined)) usage() // exactly one
          let delta: string
          if (usd !== undefined) {
            delta = usd
          } else {
            const res = await client.query<{ delta: string }>(
              'SELECT ($1::numeric * $2::numeric)::numeric(12,8)::text AS delta',
              [credits, String(CREDIT_USD)],
            )
            delta = res.rows[0]?.delta ?? '0'
          }
          // Strip trailing zeros noise for the log line only; the stored value
          // is whatever recordAdjust inserts verbatim.
          console.log(
            `adjusting user ${user.id} (${user.email}) by $${delta}. "${reason}"`,
          )
          await recordAdjust(db, user.id, delta, {
            reason,
            by: 'credits CLI',
          })
        }
        const after = await client.query(`${OVERVIEW_SQL} WHERE u.id = $1`, [
          user.id,
        ])
        console.table(after.rows)
        break
      }

      case 'reconcile': {
        // Repair drift from ledger truth. This never writes ledger rows.
        let userId: number | undefined
        if (args[0]) {
          const user = await resolveUser(client, args[0])
          userId = user.id
        }
        const reconciled = await reconcileBalances(db, userId)
        if (reconciled.length === 0) {
          console.log('nothing to reconcile. All balances match the ledger')
        } else {
          console.log('reconciled:')
          console.table(reconciled)
        }
        break
      }

      default:
        usage()
    }
  } finally {
    raw?.release()
    await pool.end()
  }
}

main().catch((err) => {
  if (!(err instanceof CliError)) console.error('credits CLI failed:', err)
  process.exitCode = 1
})
