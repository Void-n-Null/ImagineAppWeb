/**
 * Thread retention window — the single source of truth shared by BOTH the
 * server (source of truth in Neon) and the client offline cache (IndexedDB),
 * so the two can never drift out of policy agreement.
 *
 * Why 72 hours: chat transcripts persist tool results carrying Best Buy
 * product Content (prices, availability). The Best Buy API Terms of Service
 * forbid storing/caching that Content beyond a temporary window. Verbatim, a
 * developer must not:
 *
 *   "store or cache any Content except on a temporary basis not to exceed
 *    seventy-two (72) hours"
 *
 * So a thread is DESTROYED once it goes 72 hours without activity — both a
 * compliance measure and a deliberate product stance (a floor associate does
 * not need a chat four days later; see IMA-DOC-5). The cutoff keys off a
 * thread's last-update time, not its creation time: an active conversation
 * keeps refreshing its window, an abandoned one ages out and is purged.
 */

/** 72 hours in milliseconds — the maximum retention window (BB API ToS). */
export const THREAD_RETENTION_MS = 72 * 60 * 60 * 1000

/**
 * The oldest `updatedAt` (epoch ms) a thread may have and still be retained.
 * Anything at or before this instant is expired. Boundary is INCLUSIVE of the
 * live side: a thread updated exactly `THREAD_RETENTION_MS` ago is expired
 * (its window has fully elapsed), matching the server's `< now() - interval`.
 */
export function retentionCutoffMs(now: number = Date.now()): number {
  return now - THREAD_RETENTION_MS
}

/**
 * Whether a thread whose last update was `updatedAtMs` (epoch ms) has aged out
 * of the retention window as of `now`. Expired ⇔ the full 72h has elapsed, so
 * exactly-72h-old counts as expired (mirrors the server's strict `<` cutoff:
 * `updated_at < now() - interval '72 hours'`).
 */
export function isThreadExpired(
  updatedAtMs: number,
  now: number = Date.now(),
): boolean {
  return updatedAtMs <= retentionCutoffMs(now)
}
