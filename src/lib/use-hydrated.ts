import { useSyncExternalStore } from 'react'

const subscribeNever = () => () => {}

/**
 * False during SSR and the hydration render, true immediately after. The
 * canonical guard for browser-only data (localStorage caches, etc.) that
 * must not influence the first client render: React hydrates against the
 * server snapshot, then re-renders with the client value (IMA-48).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
}
