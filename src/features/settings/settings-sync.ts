/**
 * Account-level settings sync (IMA-31). localStorage (selected-model.ts,
 * chat-settings.ts) stays the synchronous in-session source of truth; this
 * module bridges it to the durable `users.settings` jsonb.
 *
 * Policy:
 *   - On change → fire-and-forget `updateUserSettings` patch (server follows
 *     local during a session; local wins).
 *   - On app start (once) → `getUserSettings`; if the server has values, write
 *     them into localStorage via the *Local applicators (which notify
 *     subscribers but DON'T re-sync up), so the server wins on first load.
 *
 * Patches are coalesced: rapid toggles merge into the pending patch and fire as
 * one round-trip. All failures are silent — settings are convenience state, not
 * correctness state.
 */

import { useEffect, useRef } from 'react'
import {
  getUserSettings,
  updateUserSettings,
} from '#/server/functions/user-settings'

/** The subset of settings keys this client mirrors (server allowlist superset). */
export interface SyncableSettings {
  selectedModel?: string
  showToolActivity?: boolean
}

/* ── push (change → server), coalesced ──────────────────────────────────── */

let inFlight = false
let pending: Record<string, unknown> | null = null

/**
 * Fire-and-forget a settings patch up to the account. If a patch is already in
 * flight, merge into the pending patch and send it when the current one
 * settles — so a burst of changes collapses to at most two writes and the
 * server always converges on the latest values.
 */
export function pushSettingUp(patch: SyncableSettings): void {
  if (typeof window === 'undefined') return
  if (inFlight) {
    pending = { ...(pending ?? {}), ...patch }
    return
  }
  send(patch as Record<string, unknown>)
}

function send(patch: Record<string, unknown>): void {
  inFlight = true
  void updateUserSettings({ data: { patch } })
    .catch(() => {})
    .finally(() => {
      inFlight = false
      if (pending) {
        const next = pending
        pending = null
        send(next)
      }
    })
}

/* ── restore (server → local), once on start ────────────────────────────── */

/**
 * Pull the account's settings and, for any known key the server has, write it
 * into localStorage through the non-syncing local applicators. Server wins on
 * first load; anything the user then changes this session wins locally and
 * pushes back up. Silent on signed-out / offline / error.
 *
 * The applicators are imported lazily to keep this module free of a static
 * dependency cycle (selected-model.ts imports pushSettingUp from here).
 */
export async function restoreSettings(): Promise<void> {
  let settings: Record<string, unknown>
  try {
    const res = await getUserSettings()
    if (res.status !== 'ok') return
    settings = res.settings
  } catch {
    return
  }

  const { applySelectedModelIdLocal } = await import(
    '#/features/models/selected-model'
  )
  const { applyShowToolActivityLocal } = await import(
    '#/features/chat/chat-settings'
  )

  if (typeof settings.selectedModel === 'string') {
    applySelectedModelIdLocal(settings.selectedModel)
  }
  if (typeof settings.showToolActivity === 'boolean') {
    applyShowToolActivityLocal(settings.showToolActivity)
  }
}

/**
 * Run {@link restoreSettings} once per mount. Ref-guarded so a re-render can't
 * re-fire it. Mount it wherever the app is reliably signed-in (the chat route);
 * on non-gated pages it's a silent noop.
 */
export function useSettingsRestore(): void {
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void restoreSettings()
  }, [])
}
