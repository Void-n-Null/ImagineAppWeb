import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { THREAD_RETENTION_MS } from '#/lib/retention'
import {
  purgeExpiredThreadsSql,
  RETENTION_SECONDS,
  retentionCutoff,
} from './threads'

/**
 * The retention window is a compliance boundary (BB API ToS: no caching Content
 * beyond 72h), so the SERVER's purge/filter SQL is pinned here. We compile the
 * exported SQL fragments with the real Postgres dialect and assert the emitted
 * text + bound params — no live DB, same DB-free doctrine as the other server
 * tests. If someone loosens the cutoff or drops the user pin, this breaks.
 */
const dialect = new PgDialect()

describe('RETENTION_SECONDS', () => {
  it('is derived from the shared 72h constant (seconds)', () => {
    expect(RETENTION_SECONDS).toBe(THREAD_RETENTION_MS / 1000)
    expect(RETENTION_SECONDS).toBe(259_200)
  })
})

describe('retentionCutoff (read filter)', () => {
  it('is now() minus a 72h interval, seconds bound as a param', () => {
    const { sql, params } = dialect.sqlToQuery(retentionCutoff())
    expect(sql).toBe('now() - make_interval(secs => $1)')
    expect(params).toEqual([RETENTION_SECONDS])
  })
})

describe('purgeExpiredThreadsSql (lazy purge)', () => {
  it('DELETEs only this user’s rows at/past the 72h cutoff', () => {
    const { sql, params } = dialect.sqlToQuery(purgeExpiredThreadsSql(42))
    const flat = sql.replace(/\s+/g, ' ').trim()

    // A DELETE against threads...
    expect(flat).toContain('DELETE FROM threads')
    // ...pinned to the caller's user_id (never a global wipe)...
    expect(flat).toContain('user_id = $1')
    // ...with a `<=` cutoff (exactly-72h-old is expired)...
    expect(flat).toContain('updated_at <= now() - make_interval(secs => $2)')
    // ...and the params in order: userId, then the window seconds.
    expect(params).toEqual([42, RETENTION_SECONDS])
  })
})
