/**
 * The account-sync layer for threads (IMA-31). IndexedDB (thread-store.ts) is
 * now an OFFLINE CACHE in front of Neon: writes go through locally first (the
 * conversation must survive offline / signed-out) and mirror UP to the server
 * fire-and-forget; on sign-in we hydrate DOWN. This closes the iOS-PWA
 * IndexedDB split (IMA-12) — the account, not the browser store, is the home
 * of a user's history.
 *
 * Conflict policy is last-write-wins by `updatedAt`: whichever side has the
 * newer timestamp is authoritative. Both the coalescing (in-flight +
 * pending-latest) and the per-thread merge decision are extracted as pure
 * functions so they're testable without a server or a renderer.
 *
 * Every server call is best-effort: failures (offline, 401 on a non-gated
 * page) are swallowed. The chat still works entirely from the local cache.
 */

import type { ChatMessage } from '#/features/agent'
import {
  deleteThread as deleteThreadFn,
  getThread as getThreadFn,
  listThreads as listThreadsFn,
  upsertThread as upsertThreadFn,
} from '#/server/functions/threads'
import {
  deriveTitle,
  listThreads as listLocalThreads,
  putServerThread,
} from './thread-store'

/* ── Coalescing ─────────────────────────────────────────────────────────── */

/**
 * Per-thread upsert coalescer. At message cadence a thread can be saved several
 * times in quick succession; we never want overlapping upserts for the same id
 * (LWW would make ordering matter, and it wastes round-trips). So: if a sync is
 * in flight for an id, we don't start a second — we stash the latest payload in
 * a single "pending" slot and fire exactly one follow-up when the in-flight one
 * settles. No timers, no queue depth: only the newest payload is ever pending,
 * because older ones are already stale under LWW.
 */
interface PendingSlot {
  inFlight: boolean
  pending: { title: string; transcript: ChatMessage[] } | null
}

export interface Coalescer {
  /** Send (or coalesce) an upsert for `id`. Never throws. */
  push(id: string, payload: { title: string; transcript: ChatMessage[] }): void
}

/**
 * Build a coalescer over an injected upsert function (the real one in prod, a
 * mock in tests). `send` must resolve when the write settles — success or
 * failure both count as "settled" so a failed sync still drains the pending
 * slot instead of wedging the thread forever.
 */
export function createCoalescer(
  send: (
    id: string,
    payload: { title: string; transcript: ChatMessage[] },
  ) => Promise<void>,
): Coalescer {
  const slots = new Map<string, PendingSlot>()

  function run(
    id: string,
    payload: { title: string; transcript: ChatMessage[] },
  ): void {
    const slot = slots.get(id) ?? { inFlight: false, pending: null }
    slot.inFlight = true
    slots.set(id, slot)
    void send(id, payload).then(
      () => settle(id),
      () => settle(id), // failures still drain the pending slot (offline-first)
    )
  }

  function settle(id: string): void {
    const slot = slots.get(id)
    if (!slot) return
    slot.inFlight = false
    if (slot.pending) {
      const next = slot.pending
      slot.pending = null
      run(id, next)
    } else {
      slots.delete(id)
    }
  }

  return {
    push(id, payload) {
      const slot = slots.get(id)
      if (slot?.inFlight) {
        // Overwrite pending: only the newest payload matters under LWW.
        slot.pending = payload
        return
      }
      run(id, payload)
    },
  }
}

// Module-level singleton coalescer wired to the real upsert server fn. Failures
// are silent (offline-first); a non-ok status is treated the same as a throw —
// the local cache already holds the truth.
const upsertCoalescer = createCoalescer(async (id, payload) => {
  await upsertThreadFn({
    data: { id, title: payload.title, transcript: payload.transcript },
  })
})

/* ── Public write-through API ───────────────────────────────────────────── */

/**
 * Mirror a thread UP to the server (fire-and-forget). Called right after the
 * local IndexedDB save in the chat hook, at the same message cadence. Title is
 * derived the same way thread-store does (deriveTitle) so the server list rows
 * match the local drawer rows.
 */
export function syncThreadUp(id: string, transcript: ChatMessage[]): void {
  if (transcript.length === 0) return // never mint empty server rows
  upsertCoalescer.push(id, { title: deriveTitle(transcript), transcript })
}

/** Delete a thread on the server (fire-and-forget). */
export function syncThreadDelete(id: string): void {
  void deleteThreadFn({ data: { id } }).catch(() => {})
}

/* ── Hydration (LWW merge) ──────────────────────────────────────────────── */

/** Per-thread decision hydrateThreads makes. Pure — tested in isolation. */
export type MergeDecision = 'pull' | 'push' | 'noop'

export interface SideMeta {
  /** epoch ms of last update, or undefined if the thread is absent this side. */
  updatedAt: number | undefined
}

/**
 * LWW merge decision for one thread id given each side's updatedAt.
 *   - server newer (or local missing) → pull down
 *   - local newer (or server missing) → push up
 *   - equal, or both missing          → nothing to do
 * Equal timestamps are a noop: identical mtime means we already agree (and
 * re-pulling would just rewrite the same bytes).
 */
export function decideMerge(local: SideMeta, server: SideMeta): MergeDecision {
  const l = local.updatedAt
  const s = server.updatedAt
  if (l === undefined && s === undefined) return 'noop'
  if (l === undefined) return 'pull'
  if (s === undefined) return 'push'
  if (s > l) return 'pull'
  if (l > s) return 'push'
  return 'noop'
}

/**
 * Reconcile the local cache with the server (LWW). Fetches the server list,
 * unions it with the local list, and per thread id: pulls the newer server
 * transcript into IndexedDB, or pushes the newer local transcript up. Newest
 * updatedAt wins. Returns void; all errors are swallowed (offline / signed-out
 * must not explode a non-gated page).
 */
export async function hydrateThreads(): Promise<void> {
  let serverList: Array<{ id: string; updatedAt: number }>
  try {
    const res = await listThreadsFn()
    if (res.status !== 'ok') return // unauthorized / error — stay local-only
    serverList = res.threads.map((t) => ({
      id: t.id,
      updatedAt: Date.parse(t.updatedAt),
    }))
  } catch {
    return
  }

  let localList: Array<{ id: string; updatedAt: number }> = []
  try {
    localList = (await listLocalThreads()).map((t) => ({
      id: t.id,
      updatedAt: t.updatedAt,
    }))
  } catch {
    localList = []
  }

  const localById = new Map(localList.map((t) => [t.id, t.updatedAt]))
  const serverById = new Map(serverList.map((t) => [t.id, t.updatedAt]))
  const ids = new Set<string>([...localById.keys(), ...serverById.keys()])

  await Promise.all(
    [...ids].map(async (id) => {
      const decision = decideMerge(
        { updatedAt: localById.get(id) },
        { updatedAt: serverById.get(id) },
      )
      if (decision === 'pull') {
        try {
          const res = await getThreadFn({ data: { id } })
          if (res.status !== 'ok') return
          await putServerThread(
            id,
            res.thread.title,
            // JsonValue[] at the wire boundary; it's a ChatMessage[] by
            // construction (upsertThread only stores validated transcripts).
            res.thread.transcript as unknown as ChatMessage[],
            Date.parse(res.thread.updatedAt),
          )
        } catch {
          // best-effort
        }
      } else if (decision === 'push') {
        // We don't have the transcript in the list; syncThreadUp reads from the
        // caller. Here we push what's local by loading it lazily.
        try {
          const { loadTranscript } = await import('./thread-store')
          const transcript = await loadTranscript(id)
          if (transcript && transcript.length > 0) syncThreadUp(id, transcript)
        } catch {
          // best-effort
        }
      }
    }),
  )
}
