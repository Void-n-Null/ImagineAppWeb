import process from 'node:process'
import { auth, clerkClient } from '@clerk/tanstack-react-start/server'
import { eq, sql } from 'drizzle-orm'
import { grantSignup } from '#/server/credits/ledger'
import { getDb } from '#/server/db'
import { users } from '#/server/db/schema'

/**
 * The auth seam (IMA-27). Everything server-side that needs identity goes
 * through getUser()/requireUser() — no other module imports Clerk's server
 * API. This is deliberate swap-to-Better-Auth insurance: if Clerk ever has
 * to go, this file is the blast radius.
 *
 * First sign-in creates our `users` row. `users.id` (serial) is assigned
 * here, and IS the FIFO signup order for credit grants (IMA-DOC-16).
 */

export interface AppUser {
  /** Our serial id — metering identity + FIFO signup order. */
  id: number
  clerkUserId: string
  email: string | null
  /** numeric(12,8) comes back as a string; parse at point of use. */
  balanceUsd: string
  /** True when this call created the row (first sign-in). Racy only in the
   *  harmless direction: concurrent first requests may both report true, so
   *  anything hooked on it (signup grant, Phase 3) must be idempotent. */
  isNew: boolean
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'UnauthorizedError'
  }
}

/** Best-effort email copy for admin visibility — never blocks sign-in. */
async function fetchClerkEmail(clerkUserId: string): Promise<string | null> {
  try {
    const cu = await clerkClient().users.getUser(clerkUserId)
    return (
      cu.primaryEmailAddress?.emailAddress ??
      cu.emailAddresses[0]?.emailAddress ??
      null
    )
  } catch {
    return null
  }
}

/** Current user, creating our row on first sign-in. Null when signed out. */
export async function getUser(): Promise<AppUser | null> {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return null

  const db = getDb()
  const existing = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  })
  if (existing) return { ...existing, isNew: false }

  const email = await fetchClerkEmail(clerkUserId)
  const [row] = await db
    .insert(users)
    .values({ clerkUserId, email })
    // Concurrent first requests: loser of the race updates nothing real
    // (COALESCE keeps any existing email) but still gets the row back.
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { email: sql`COALESCE(${users.email}, EXCLUDED.email)` },
    })
    .returning()
  if (!row) throw new Error('users upsert returned no row')

  // Signup grant hook (IMA-16 #361): best-effort. grantSignup is idempotent
  // (one grant per user enforced by ledger_user_grant_idx), so the racy
  // isNew — two concurrent first requests may both land here — is harmless;
  // the DB lets exactly one grant through. A failure here (pool unreachable,
  // waitlisted) is non-fatal: sign-in must never block on the grant, and
  // syncPool repairs the waitlist later. Keep Clerk the only identity
  // touchpoint; grantSignup is our own code, so importing it is fine.
  try {
    await grantSignup(db, row.id)
  } catch (err) {
    console.error('[auth] signup grant failed for user', row.id, err)
  }

  return { ...row, isNew: true }
}

/** Like getUser(), but signed-out is an error. For gated server functions. */
export async function requireUser(): Promise<AppUser> {
  const user = await getUser()
  if (!user) throw new UnauthorizedError()
  return user
}

/** Raised when a signed-in user isn't on the admin allowlist. */
export class ForbiddenError extends Error {
  constructor() {
    super('Not authorized')
    this.name = 'ForbiddenError'
  }
}

/**
 * Admin gate for pool-management server functions (IMA-16 Phase 3). Authorized
 * iff signed in AND the user's email (case-insensitive) is in the
 * comma-separated ADMIN_EMAILS env var. An absent env or non-match is a
 * ForbiddenError; signed-out is UnauthorizedError. Deliberately conservative:
 * no env → nobody is admin (fails closed).
 */
export async function requireAdmin(): Promise<AppUser> {
  const user = await getUser()
  if (!user) throw new UnauthorizedError()

  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
  const email = user.email?.trim().toLowerCase()
  if (!email || !allow.includes(email)) throw new ForbiddenError()
  return user
}
