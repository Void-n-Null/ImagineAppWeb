import { useQuery } from '@tanstack/react-query'
import { useHydrated } from '#/lib/use-hydrated'
import { fetchModelCatalog, readCatalogSnapshot } from './fetch-catalog'
import type { ModelCatalog } from './types'

/**
 * The model catalog, cached hard: the data changes ~daily, so an hour of
 * staleness is free performance. The localStorage snapshot paints almost
 * instantly (placeholderData) while the real fetch revalidates in the
 * background.
 *
 * The snapshot is gated on hydration: the server cannot read localStorage,
 * so letting the client read it during the hydration render made model
 * names differ between server and client text (React #418 on /settings and
 * /chat, IMA-48). One post-hydration render later the snapshot applies.
 */
export function useModelCatalog() {
  const hydrated = useHydrated()
  return useQuery<ModelCatalog>({
    queryKey: ['model-catalog'],
    queryFn: fetchModelCatalog,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: hydrated
      ? () => readCatalogSnapshot() ?? undefined
      : undefined,
    retry: 1,
  })
}
