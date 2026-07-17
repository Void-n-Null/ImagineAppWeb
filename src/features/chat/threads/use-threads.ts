/**
 * React bindings for the thread store. The list is a react-query cache
 * entry invalidated by whoever mutates threads (the chat hook after each
 * save, the drawer after a delete) — IndexedDB has no change events of its
 * own, so invalidation is the change signal.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { deleteThread, listThreads, type ThreadMeta } from './thread-store'
import { hydrateThreads, syncThreadDelete } from './thread-sync'

export const THREADS_QUERY_KEY = ['chat-threads'] as const

export function useThreadList() {
  return useQuery<ThreadMeta[]>({
    queryKey: THREADS_QUERY_KEY,
    queryFn: listThreads,
    staleTime: 0,
  })
}

/**
 * Reconcile the local cache with the account once per mount (IMA-31): pull down
 * server threads newer/missing locally, push up local ones newer than the
 * server (LWW), then invalidate so the list re-reads the merged cache. Runs
 * once — the ref guard means a re-render can't re-fire it. Signed-out / offline
 * is a silent noop inside hydrateThreads, so mounting this anywhere (drawer,
 * chat route) is safe.
 */
export function useThreadHydration(): void {
  const queryClient = useQueryClient()
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void hydrateThreads().then(() =>
      queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }),
    )
  }, [queryClient])
}

export function useDeleteThread(): (id: string) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (id: string) => {
      await deleteThread(id)
      // Mirror the delete UP to the account (fire-and-forget) — IMA-31.
      syncThreadDelete(id)
      await queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
    },
    [queryClient],
  )
}
