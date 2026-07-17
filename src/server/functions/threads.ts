import { createServerFn } from '@tanstack/react-start'
import { type SQL, sql } from 'drizzle-orm'
import { THREAD_RETENTION_MS } from '#/lib/retention'
import { requireUser, UnauthorizedError } from '#/server/auth'
import { getDb } from '#/server/db'
import {
  isValidThreadId,
  type JsonValue,
  normalizeTitle,
  validateTranscript,
} from './thread-validation'

/**
 * Account-level thread persistence (IMA-31) — the server side of promoting the
 * device-local IndexedDB store (IMA-9) to durable Neon storage. This fixes the
 * iOS PWA IndexedDB split (IMA-12) where standalone-vs-Safari saw different
 * histories: Neon is now the source of truth, IndexedDB an offline mirror.
 *
 * Auth: every function is sign-in gated (requireUser) and pins user_id in every
 * WHERE. Thread ids are CLIENT-generated and the PK is global, so a colliding
 * id from another user must never be readable or writable — the upsert checks
 * ownership at the DB and reports an ownership error on a cross-user collision.
 * Signed-out is an error VALUE (never a throw across the wire), so callers on
 * non-gated pages degrade to local-only silently.
 */

export interface ThreadListItem {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

export type ListThreadsResult =
  | { status: 'ok'; threads: ThreadListItem[] }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }

export interface ThreadDetail {
  id: string
  title: string
  /** The stored ChatMessage[] — typed as JsonValue[] at the wire boundary
   *  (the client casts it back to ChatMessage[]). */
  transcript: JsonValue[]
  updatedAt: string
}

export type GetThreadResult =
  | { status: 'ok'; thread: ThreadDetail }
  | { status: 'not_found' }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }

export type UpsertThreadResult =
  | { status: 'ok'; updatedAt: string }
  | { status: 'invalid'; message: string }
  | { status: 'conflict' } // cross-user id collision — ownership denied
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }

export type DeleteThreadResult =
  | { status: 'ok' }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }

/* ── 72-hour retention (BB API ToS) ─────────────────────────────────────── */

/**
 * The retention window as whole seconds, derived from the ONE shared constant
 * (src/lib/retention.ts) so server and client never disagree on the policy.
 * Expressed in seconds because Postgres `make_interval(secs => …)` is exact and
 * avoids parsing a hand-written `interval '72 hours'` string — and because
 * sourcing it from THREAD_RETENTION_MS means bumping the constant moves both
 * sides at once. Exported (pure) so the cutoff can be asserted without a DB.
 */
export const RETENTION_SECONDS = THREAD_RETENTION_MS / 1000

/**
 * The cutoff instant `now() - 72h`. One expression reused by both the purge
 * DELETE and every read filter so a purge that fails (or races) can never leak
 * an expired thread — the read WHERE excludes it regardless.
 *
 * Boundary: a thread updated exactly 72h ago is EXPIRED — the full window has
 * elapsed. So the purge deletes `updated_at <= cutoff` and reads keep
 * `updated_at > cutoff`. These agree with each other (nothing is
 * deleted-but-still-served, or retained-but-unservable) and with the client's
 * `isThreadExpired` (`<=` cutoff → expired) in src/lib/retention.ts.
 */
export function retentionCutoff(): SQL {
  return sql`now() - make_interval(secs => ${RETENTION_SECONDS})`
}

/**
 * The lazy-purge DELETE for one user, as a pure SQL fragment (exported so the
 * exact statement — table, user pin, `<=` cutoff — is unit-testable via
 * PgDialect without a live DB). `<=`: a thread updated exactly 72h ago is
 * expired (its full window has elapsed).
 */
export function purgeExpiredThreadsSql(userId: number): SQL {
  return sql`
    DELETE FROM threads
    WHERE user_id = ${userId} AND updated_at <= ${retentionCutoff()}
  `
}

/**
 * Lazy purge: DELETE this user's threads whose window has fully elapsed. Run at
 * the top of every list/get/upsert so expired transcripts (which carry Best Buy
 * Content) are destroyed on the next touch rather than lingering for a cron.
 * Scoped to one user_id — cheap, index-friendly (threads_user_updated_idx), and
 * race-safe: a single atomic statement, and two concurrent callers deleting the
 * same already-expired rows is harmless (the second just deletes nothing).
 */
async function purgeExpiredThreads(userId: number): Promise<void> {
  await getDb().execute(purgeExpiredThreadsSql(userId))
}

/* ── list ───────────────────────────────────────────────────────────────── */

/**
 * The thread list: meta only — jsonb_array_length instead of the transcripts,
 * because transcripts carry base64 image data URLs (potentially megabytes) and
 * the list never needs them. Newest activity first, capped at 200.
 */
export const listThreads = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ListThreadsResult> => {
    let userId: number
    try {
      userId = (await requireUser()).id
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: 'unauthorized' }
      throw err
    }
    try {
      // Destroy anything past the 72h window first, then read only what's still
      // in-window — the filter is the safety net if the purge ever fails.
      await purgeExpiredThreads(userId)
      const res = await getDb().execute<{
        id: string
        title: string
        updated_at: string
        message_count: number
      }>(sql`
        SELECT id, title, updated_at,
               jsonb_array_length(transcript) AS message_count
        FROM threads
        WHERE user_id = ${userId} AND updated_at > ${retentionCutoff()}
        ORDER BY updated_at DESC
        LIMIT 200
      `)
      return {
        status: 'ok',
        threads: res.rows.map((r) => ({
          id: r.id,
          title: r.title,
          updatedAt: new Date(r.updated_at).toISOString(),
          messageCount: Number(r.message_count),
        })),
      }
    } catch (err) {
      return { status: 'error', message: errorMessage(err) }
    }
  },
)

/* ── get ────────────────────────────────────────────────────────────────── */

export const getThread = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown): { id: string } => {
    const id = (input as { id?: unknown })?.id
    if (!isValidThreadId(id)) throw new Error('invalid thread id')
    return { id }
  })
  .handler(async ({ data }): Promise<GetThreadResult> => {
    let userId: number
    try {
      userId = (await requireUser()).id
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: 'unauthorized' }
      throw err
    }
    try {
      // Purge first, then pin the same cutoff on the read: an expired thread is
      // never returned even if the purge lost a race or errored.
      await purgeExpiredThreads(userId)
      const res = await getDb().execute<{
        id: string
        title: string
        transcript: JsonValue[]
        updated_at: string
      }>(sql`
        SELECT id, title, transcript, updated_at
        FROM threads
        WHERE id = ${data.id} AND user_id = ${userId}
          AND updated_at > ${retentionCutoff()}
        LIMIT 1
      `)
      const row = res.rows[0]
      if (!row) return { status: 'not_found' }
      return {
        status: 'ok',
        thread: {
          id: row.id,
          title: row.title,
          transcript: row.transcript,
          updatedAt: new Date(row.updated_at).toISOString(),
        },
      }
    } catch (err) {
      return { status: 'error', message: errorMessage(err) }
    }
  })

/* ── upsert ─────────────────────────────────────────────────────────────── */

interface UpsertInput {
  id: string
  title: string
  transcript: JsonValue[]
}

export const upsertThread = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown): UpsertInput => {
    const obj = (input ?? {}) as Record<string, unknown>
    if (!isValidThreadId(obj.id)) throw new Error('invalid thread id')
    const check = validateTranscript(obj.transcript)
    if (!check.ok) throw new Error(check.reason)
    return {
      id: obj.id,
      title: normalizeTitle(obj.title), // truncate, never reject
      transcript: check.transcript as JsonValue[],
    }
  })
  .handler(async ({ data }): Promise<UpsertThreadResult> => {
    let userId: number
    try {
      userId = (await requireUser()).id
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: 'unauthorized' }
      throw err
    }
    try {
      // Opportunistic purge on write too, so an active user's expired siblings
      // are reaped even if they never open the list. The row we're about to
      // write stamps updated_at = now(), so it's always in-window itself.
      await purgeExpiredThreads(userId)
      // LWW: updated_at = now() on every write. ON CONFLICT (id) DO UPDATE
      // pinned to `threads.user_id = excluded.user_id` — a colliding id owned
      // by another user matches NO row in the UPDATE's WHERE, so RETURNING
      // yields zero rows and we surface an ownership conflict rather than
      // silently touching (or worse, exposing) someone else's thread.
      const res = await getDb().execute<{ updated_at: string }>(sql`
        INSERT INTO threads (id, user_id, title, transcript, updated_at)
        VALUES (
          ${data.id},
          ${userId},
          ${data.title},
          ${JSON.stringify(data.transcript)}::jsonb,
          now()
        )
        ON CONFLICT (id) DO UPDATE
          SET title = excluded.title,
              transcript = excluded.transcript,
              updated_at = now()
          WHERE threads.user_id = excluded.user_id
        RETURNING updated_at
      `)
      const row = res.rows[0]
      if (!row) {
        // Insert conflicted on id but the ownership guard rejected the UPDATE:
        // the existing row belongs to a different user.
        return { status: 'conflict' }
      }
      return { status: 'ok', updatedAt: new Date(row.updated_at).toISOString() }
    } catch (err) {
      return { status: 'error', message: errorMessage(err) }
    }
  })

/* ── delete ─────────────────────────────────────────────────────────────── */

export const deleteThread = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown): { id: string } => {
    const id = (input as { id?: unknown })?.id
    if (!isValidThreadId(id)) throw new Error('invalid thread id')
    return { id }
  })
  .handler(async ({ data }): Promise<DeleteThreadResult> => {
    let userId: number
    try {
      userId = (await requireUser()).id
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: 'unauthorized' }
      throw err
    }
    try {
      // user_id pinned: a delete can only ever reach the caller's own row.
      await getDb().execute(sql`
        DELETE FROM threads WHERE id = ${data.id} AND user_id = ${userId}
      `)
      return { status: 'ok' }
    } catch (err) {
      return { status: 'error', message: errorMessage(err) }
    }
  })

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
