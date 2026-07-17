import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Schema v1 — users + ledger (IMA-27, design: IMA-DOC-16 "Accounting model").
 *
 * Money is stored in USD as numeric(12,8); credits are a DISPLAY unit only
 * (1 credit = $0.005, `floor(balance_usd / 0.005)`). Per-generation costs are
 * ~$0.0002, so rounding to whole credits would overcharge ~25x.
 *
 * `users.id` (serial) IS the FIFO signup order — there is no separate
 * waitlist table. The waitlist is: users with no `grant` ledger row,
 * ordered by id ASC.
 */

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  /** Best-effort copy from Clerk at first sign-in — admin visibility only.
   *  Clerk remains the identity source of truth. */
  email: text('email'),
  /** Fast-path balance, maintained under a row lock in the same transaction
   *  as every ledger insert. Audit invariant: equals SUM(ledger.usd). */
  balanceUsd: numeric('balance_usd', { precision: 12, scale: 8 })
    .notNull()
    .default('0'),
  /**
   * Account-level user settings (IMA-31) — the source of truth that outlives
   * a device. localStorage stays the synchronous in-session cache; this column
   * is the durable copy synced on change and restored on first load. A flat
   * bag guarded by an allowlist server-side (selectedModel, showToolActivity),
   * shallow-merged in SQL (`settings || $patch`) so partial writes never
   * clobber sibling keys.
   */
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/**
 * Chat threads (IMA-31) — account-level transcript persistence, promoting the
 * device-local IndexedDB store (IMA-9) to an offline cache. This fixes IMA-12:
 * iOS PWA split IndexedDB between the standalone app and Safari, so a user's
 * history vanished depending on where they opened the app. Neon is now the
 * durable home; IndexedDB is the fast local mirror synced via LWW.
 *
 * The PK is the CLIENT-generated thread id (generateThreadId) — global, not
 * per-user. Because two users could in principle mint the same id, EVERY query
 * pins user_id and the upsert verifies ownership (ON CONFLICT ... WHERE
 * user_id = excluded.user_id); a cross-user id collision must never be
 * readable or writable. Astronomically unlikely, but money-era code doesn't
 * assume.
 */
export const threads = pgTable(
  'threads',
  {
    /** Client-generated (generateThreadId); validated for shape before write. */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull().default(''),
    /** The full ChatMessage[] stored as-is — image data URLs and all. */
    transcript: jsonb('transcript').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Drives listThreads: every list is scoped to one user, newest first.
    index('threads_user_updated_idx').on(t.userId, t.updatedAt.desc()),
  ],
)

export const ledger = pgTable(
  'ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ['grant', 'spend', 'adjust'] }).notNull(),
    /** Signed: grants positive, spends negative, adjusts either. */
    usd: numeric('usd', { precision: 12, scale: 8 }).notNull(),
    /** e.g. { generationId, model, tool } for spends; { poolSync } for grants. */
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('ledger_user_id_idx').on(t.userId),
    // One grant per user, enforced by the DB (IMA-16 Phase 3). This is the
    // idempotency guarantee grantSignup relies on: the INSERT ... ON CONFLICT
    // DO NOTHING that races two concurrent first-sign-ins can produce AT MOST
    // one grant row. It doubles as the waitlist scan index ("users with no
    // grant row" ORDER BY id). UNIQUE + partial: only kind='grant' rows are
    // constrained, so the many spend/adjust rows per user are unaffected.
    uniqueIndex('ledger_user_grant_idx')
      .on(t.userId)
      .where(sql`${t.kind} = 'grant'`),
    // Idempotent spend recording (IMA-16 Phase 3): OpenRouter's generationId
    // is the natural dedupe key. A retried onUsage / fallback-cost path must
    // not double-charge, so the INSERT for a spend uses ON CONFLICT DO NOTHING
    // against this expression index. Partial: only spends that actually carry
    // a generationId are constrained (Exa/voice fire-once spends have none and
    // are intentionally not deduped here — see recordSpend).
    uniqueIndex('ledger_spend_generation_idx')
      .on(sql`(${t.meta} ->> 'generationId')`)
      .where(
        sql`${t.kind} = 'spend' AND ${t.meta} ->> 'generationId' IS NOT NULL`,
      ),
    // Append-only table gets DB-level integrity, not just TS enums.
    check('ledger_kind_check', sql`${t.kind} IN ('grant', 'spend', 'adjust')`),
  ],
)

export type UserRow = typeof users.$inferSelect
export type LedgerRow = typeof ledger.$inferSelect
export type LedgerKind = LedgerRow['kind']
export type ThreadRow = typeof threads.$inferSelect
