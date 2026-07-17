import { createServerFn } from '@tanstack/react-start'
import { requireAdmin } from '#/server/auth'
import type { SyncPoolResult } from '#/server/credits/sync'
import { type AdminStats, adminStats, syncPool } from '#/server/credits/sync'

/**
 * Admin-only credit-pool server functions (IMA-16 Phase 3, design: IMA-DOC-16
 * "Top-up flow"). Both gate on requireAdmin() (email ∈ ADMIN_EMAILS) and,
 * like every server function here, return error VALUES rather than throwing so
 * the caller renders a message instead of crashing.
 *
 * These move REAL grant liability (syncPool issues grants), so the auth gate
 * is the first thing that runs — no pool read, no DB scan for a non-admin.
 */

export type AdminSyncResult =
  | ({ status: 'ok' } & SyncPoolResult)
  | { status: 'error'; message: string }

export type AdminStatsResult =
  | ({ status: 'ok' } & AdminStats)
  | { status: 'error'; message: string }

/** Guard both endpoints: signed-in admin, or an error value. */
async function ensureAdmin(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    await requireAdmin()
    return { ok: true }
  } catch {
    // Collapse Unauthorized + Forbidden into one opaque message — don't leak
    // whether the caller is signed out vs. not-an-admin.
    return { ok: false, message: 'Not authorized' }
  }
}

/**
 * Issue grants down the FIFO waitlist against a fresh pool balance. Call after
 * a top-up. Idempotent-ish: safe to run repeatedly (grantSignup dedupes).
 */
export const adminSyncPool = createServerFn({ method: 'POST' }).handler(
  async (): Promise<AdminSyncResult> => {
    const gate = await ensureAdmin()
    if (!gate.ok) return { status: 'error', message: gate.message }
    try {
      const result = await syncPool()
      return { status: 'ok', ...result }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'error', message: `Pool sync failed: ${message}` }
    }
  },
)

/** Full credit snapshot: pool remaining, outstanding, spend, per-user rows, drift. */
export const adminCreditStats = createServerFn({ method: 'POST' }).handler(
  async (): Promise<AdminStatsResult> => {
    const gate = await ensureAdmin()
    if (!gate.ok) return { status: 'error', message: gate.message }
    try {
      const stats = await adminStats()
      return { status: 'ok', ...stats }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'error', message: `Stats failed: ${message}` }
    }
  },
)
