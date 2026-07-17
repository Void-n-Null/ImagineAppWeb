import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { requireUser, UnauthorizedError } from '#/server/auth'
import { getDb } from '#/server/db'
import { type JsonValue, validateSettingsPatch } from './thread-validation'

/**
 * Account-level user settings (IMA-31). localStorage stays the synchronous
 * in-session cache (selected-model.ts / chat-settings.ts); this is the durable
 * account copy. Server wins on first load; local wins during a session.
 *
 * The patch is shallow-merged IN SQL (`settings = settings || $patch::jsonb`)
 * so a partial write never clobbers sibling keys, and validated against a
 * KNOWN-KEY allowlist (validateSettingsPatch) — unknown keys are rejected, not
 * silently persisted.
 */

export type GetUserSettingsResult =
  | { status: 'ok'; settings: Record<string, JsonValue> }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }

export type UpdateUserSettingsResult =
  | { status: 'ok'; settings: Record<string, JsonValue> }
  | { status: 'invalid'; message: string }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }

export const getUserSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GetUserSettingsResult> => {
    let userId: number
    try {
      userId = (await requireUser()).id
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: 'unauthorized' }
      throw err
    }
    try {
      const res = await getDb().execute<{
        settings: Record<string, JsonValue>
      }>(sql`SELECT settings FROM users WHERE id = ${userId} LIMIT 1`)
      return { status: 'ok', settings: res.rows[0]?.settings ?? {} }
    } catch (err) {
      return { status: 'error', message: errorMessage(err) }
    }
  },
)

export const updateUserSettings = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown): { patch: Record<string, JsonValue> } => {
    const patch = (input as { patch?: unknown })?.patch
    const check = validateSettingsPatch(patch)
    if (!check.ok) throw new Error(check.reason)
    return { patch: check.patch as Record<string, JsonValue> }
  })
  .handler(async ({ data }): Promise<UpdateUserSettingsResult> => {
    let userId: number
    try {
      userId = (await requireUser()).id
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: 'unauthorized' }
      throw err
    }
    try {
      // Shallow-merge in SQL: `||` on jsonb replaces top-level keys present in
      // the patch and leaves the rest untouched — no read-modify-write race.
      const res = await getDb().execute<{
        settings: Record<string, JsonValue>
      }>(sql`
        UPDATE users
        SET settings = settings || ${JSON.stringify(data.patch)}::jsonb
        WHERE id = ${userId}
        RETURNING settings
      `)
      return { status: 'ok', settings: res.rows[0]?.settings ?? {} }
    } catch (err) {
      return { status: 'error', message: errorMessage(err) }
    }
  })

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
