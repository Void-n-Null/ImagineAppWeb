import { useInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, PackageSearch, Store, Tag } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { BestBuyAttribution } from '#/features/about/bestbuy-attribution'
import { capture } from '#/features/analytics/analytics'
import { ProductResultCard } from '#/features/product-search/result-card'
import { ProductSearchBar } from '#/features/product-search/search-bar'
import { cn } from '#/lib/utils'
import type { ProductFacets } from '#/server/bestbuy/types'
import {
  isSearchSort,
  type SearchProductsResult,
  type SearchSort,
  searchProducts,
} from '#/server/functions/search-products'

interface SearchPageParams {
  q: string
  sort?: SearchSort
  min?: number
  max?: number
  sale?: boolean
  brand?: string
}

export const Route = createFileRoute('/_app/search')({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): SearchPageParams => ({
    q: typeof search.q === 'string' ? search.q : '',
    sort: isSearchSort(search.sort) ? search.sort : undefined,
    min:
      typeof search.min === 'number' && search.min >= 0
        ? search.min
        : undefined,
    max:
      typeof search.max === 'number' && search.max > 0 ? search.max : undefined,
    sale: search.sale === true ? true : undefined,
    brand:
      typeof search.brand === 'string' && search.brand.length > 0
        ? search.brand
        : undefined,
  }),
})

const SORT_LABELS: Record<SearchSort, string> = {
  'customerReviewCount.dsc': 'Most popular',
  'salePrice.asc': 'Price: low to high',
  'salePrice.dsc': 'Price: high to low',
  'customerReviewAverage.dsc': 'Highest rated',
  'releaseDate.dsc': 'Newest',
}

function SearchPage() {
  const params = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = params.q.trim()
  // View filter only — the server always fetches unfiltered so both toggle
  // states share one cache entry per page, and flipping costs zero requests.
  const [inStoreOnly, setInStoreOnly] = useState(true)

  const serverFilters = useMemo(
    () => ({
      sort: params.sort,
      minPrice: params.min,
      maxPrice: params.max,
      onSale: params.sale,
      brand: params.brand,
    }),
    [params.sort, params.min, params.max, params.sale, params.brand],
  )

  const results = useInfiniteQuery({
    queryKey: ['product-search', query, serverFilters],
    enabled: query.length > 0,
    initialPageParam: 1,
    queryFn: ({ pageParam }): Promise<SearchProductsResult> =>
      searchProducts({ data: { query, page: pageParam, ...serverFilters } }),
    getNextPageParam: (last) =>
      last.status === 'ok' && last.page.currentPage < last.page.totalPages
        ? last.page.currentPage + 1
        : undefined,
    // Server-side cache already expires at the sale rollover; within a
    // session the same query should never refetch.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const pages = results.data?.pages ?? []
  const firstError = pages.find(
    (page): page is Extract<SearchProductsResult, { status: 'error' }> =>
      page.status === 'error',
  )
  const loaded = pages.flatMap((page) =>
    page.status === 'ok' ? page.page.products : [],
  )
  const visible = inStoreOnly
    ? loaded.filter((product) => product.inStoreAvailability === true)
    : loaded
  const hiddenCount = loaded.length - visible.length
  const total = pages[0]?.status === 'ok' ? pages[0].page.total : loaded.length

  // Brand options come from the facet rollup of the UNbranded response for
  // this query+filters; they stay up while a brand is applied so the user
  // can hop between brands without clearing first.
  const [brandOptions, setBrandOptions] = useState<ProductFacets[string]>({})
  const firstPage = pages[0]
  const reportedQueryRef = useRef<string | null>(null)
  useEffect(() => {
    if (reportedQueryRef.current !== query) reportedQueryRef.current = null
    if (query.length === 0 || firstPage?.status !== 'ok') return
    if (reportedQueryRef.current === query) return

    const resultCount = firstPage.page.total
    capture('search_results_loaded', {
      query,
      result_count: resultCount,
      zero_results: firstPage.page.products.length === 0,
    })
    reportedQueryRef.current = query
  }, [firstPage, query])

  useEffect(() => {
    if (params.brand !== undefined) return
    if (firstPage?.status !== 'ok') return
    setBrandOptions(firstPage.page.facets?.manufacturer ?? {})
  }, [firstPage, params.brand])

  const setSearch = (patch: Partial<SearchPageParams>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const filtersActive =
    params.sort !== undefined ||
    params.min !== undefined ||
    params.max !== undefined ||
    params.sale === true ||
    params.brand !== undefined

  // Auto-page: chain-fetches while the sentinel stays visible, which also
  // covers pages whose items are all view-filtered out.
  const canLoadMore =
    results.hasNextPage &&
    !results.isFetchingNextPage &&
    firstError === undefined
  const sentinelRef = useAutoLoadMore(canLoadMore, () => {
    void results.fetchNextPage()
  })

  return (
    <div className="flex flex-col gap-4 px-5">
      {/*
        Sticky search + filters: mid-infinite-scroll you can always refine
        the query or flip a filter without scrolling back up.
        Translucent floor + blur so cards sliding beneath stay legible.
      */}
      <header className="rise-in sticky top-0 z-10 -mx-5 -mt-[env(safe-area-inset-top)] flex flex-col gap-2.5 border-b border-line bg-bg/90 px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <p className="aisle-label">Product search</p>
          {/* Required source mark, top corner: every result card below is
              Best Buy API data. */}
          <BestBuyAttribution className="-my-3" />
        </div>
        <ProductSearchBar
          initialQuery={params.q}
          autoFocus={query.length === 0}
        />

        <div className="scrollbar-none -mx-5 flex items-center gap-1.5 overflow-x-auto px-5">
          {/*
            ON = solid action fill + check; OFF = hollow outline. Tint-only
            state differences fail at arm's length under store lighting
            (IMA-DOC-5 state-clarity rule) — never subtle-vs-raised alone.
          */}
          <FilterToggle
            on={inStoreOnly}
            onClick={() => setInStoreOnly((on) => !on)}
            icon={<Store size={14} aria-hidden="true" />}
            label="Sold in stores"
          />
          <FilterToggle
            on={params.sale === true}
            onClick={() => setSearch({ sale: params.sale ? undefined : true })}
            icon={<Tag size={14} aria-hidden="true" />}
            label="On sale"
          />
          <PriceFilterChip
            min={params.min}
            max={params.max}
            onApply={(min, max) => setSearch({ min, max })}
          />
          <label className="flex shrink-0 items-center">
            <span className="sr-only">Sort results</span>
            <select
              value={params.sort ?? 'customerReviewCount.dsc'}
              onChange={(e) =>
                setSearch({
                  sort:
                    e.target.value === 'customerReviewCount.dsc'
                      ? undefined
                      : (e.target.value as SearchSort),
                })
              }
              className={cn(
                'h-9 rounded-full border px-3 text-caption font-bold',
                params.sort !== undefined
                  ? 'border-transparent bg-action text-action-ink'
                  : 'border-line-strong bg-transparent text-text-faint',
              )}
            >
              {(Object.keys(SORT_LABELS) as SearchSort[]).map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(Object.keys(brandOptions).length > 0 ||
          params.brand !== undefined) && (
          <nav
            aria-label="Filter by brand"
            className="scrollbar-none -mx-5 flex gap-1.5 overflow-x-auto px-5"
          >
            <BrandChip
              label="All brands"
              active={params.brand === undefined}
              onClick={() => setSearch({ brand: undefined })}
            />
            {params.brand !== undefined &&
              brandOptions[params.brand] === undefined && (
                <BrandChip label={params.brand} active onClick={() => {}} />
              )}
            {Object.entries(brandOptions).map(([brand, count]) => (
              <BrandChip
                key={brand}
                label={brand}
                count={count}
                active={params.brand === brand}
                onClick={() =>
                  setSearch({
                    brand: params.brand === brand ? undefined : brand,
                  })
                }
              />
            ))}
          </nav>
        )}
      </header>

      {query.length === 0 ? (
        <EmptyHint />
      ) : results.isPending ? (
        <SkeletonList />
      ) : firstError !== undefined && visible.length === 0 ? (
        <ErrorState
          message={firstError.message}
          rateLimited={firstError.rateLimited}
        />
      ) : visible.length === 0 && !results.hasNextPage ? (
        <NoMatches
          query={query}
          inStoreOnly={inStoreOnly}
          filtersActive={filtersActive}
          onClearFilters={() =>
            setSearch({
              sort: undefined,
              min: undefined,
              max: undefined,
              sale: undefined,
              brand: undefined,
            })
          }
        />
      ) : (
        <section className="rise-in flex flex-col gap-2 pb-4">
          <p className="tabular text-caption text-text-faint">
            {total.toLocaleString()} match{total === 1 ? '' : 'es'}
            {inStoreOnly && hiddenCount > 0 && (
              <> · {hiddenCount.toLocaleString()} online-only hidden</>
            )}
          </p>
          <ul className="flex flex-col gap-2">
            {visible.map((product) => (
              <ProductResultCard key={product.sku} product={product} />
            ))}
          </ul>

          {/* Infinite scroll sentinel — begins loading ~600px early. */}
          <div ref={sentinelRef} aria-hidden="true" />
          {(results.isFetchingNextPage ||
            (results.hasNextPage && visible.length === 0)) && (
            <LoadingMoreRow />
          )}
          {firstError !== undefined && (
            <p className="text-center text-caption text-danger">
              {firstError.message}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

/* ── Filter controls ──────────────────────────────────────────────────── */

function FilterToggle({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-caption font-bold transition-colors duration-150',
        on
          ? 'bg-action text-action-ink'
          : 'border border-line-strong bg-transparent text-text-faint',
      )}
    >
      {on ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : icon}
      {label}
    </button>
  )
}

/**
 * Price band: the chip shows the applied range; tapping opens an inline
 * min/max editor. Quick presets cover the questions customers actually ask
 * ("under $100 / under $500").
 */
function PriceFilterChip({
  min,
  max,
  onApply,
}: {
  min: number | undefined
  max: number | undefined
  onApply: (min: number | undefined, max: number | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [minText, setMinText] = useState(min?.toString() ?? '')
  const [maxText, setMaxText] = useState(max?.toString() ?? '')
  const active = min !== undefined || max !== undefined

  useEffect(() => {
    setMinText(min?.toString() ?? '')
    setMaxText(max?.toString() ?? '')
  }, [min, max])

  const label = active
    ? min !== undefined && max !== undefined
      ? `$${min}–$${max}`
      : min !== undefined
        ? `$${min}+`
        : `Under $${max}`
    : 'Price'

  const apply = () => {
    const parsedMin = minText.trim() === '' ? undefined : Number(minText)
    const parsedMax = maxText.trim() === '' ? undefined : Number(maxText)
    onApply(
      parsedMin !== undefined && Number.isFinite(parsedMin) && parsedMin >= 0
        ? parsedMin
        : undefined,
      parsedMax !== undefined && Number.isFinite(parsedMax) && parsedMax > 0
        ? parsedMax
        : undefined,
    )
    setOpen(false)
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-caption font-bold transition-colors duration-150',
          active
            ? 'bg-action text-action-ink'
            : 'border border-line-strong bg-transparent text-text-faint',
        )}
      >
        {label}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close price filter"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
            tabIndex={-1}
          />
          <div className="chrome-float absolute left-0 z-20 mt-1.5 flex w-64 flex-col gap-2.5 rounded-xl p-3">
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Min"
                aria-label="Minimum price"
                value={minText}
                onChange={(e) => setMinText(e.target.value)}
                className="h-10 w-full rounded-lg bg-raised px-3 text-body-lg text-text placeholder:text-text-faint"
              />
              <span className="text-text-faint">–</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Max"
                aria-label="Maximum price"
                value={maxText}
                onChange={(e) => setMaxText(e.target.value)}
                className="h-10 w-full rounded-lg bg-raised px-3 text-body-lg text-text placeholder:text-text-faint"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[100, 250, 500, 1000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setMinText('')
                    setMaxText(String(preset))
                    onApply(undefined, preset)
                    setOpen(false)
                  }}
                  className="min-h-8 rounded-full bg-raised px-3 text-caption font-semibold text-text-muted"
                >
                  Under ${preset}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={apply}
                className="min-h-10 flex-1 rounded-lg bg-action text-body-sm font-bold text-action-ink active:scale-[0.98]"
              >
                Apply
              </button>
              {active && (
                <button
                  type="button"
                  onClick={() => {
                    onApply(undefined, undefined)
                    setOpen(false)
                  }}
                  className="min-h-10 rounded-lg bg-raised px-4 text-body-sm font-bold text-text-muted"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function BrandChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-caption capitalize transition-colors duration-150',
        active
          ? 'bg-action-subtle font-bold text-action'
          : 'bg-raised font-medium text-text-muted active:bg-surface',
      )}
    >
      {label}
      {count !== undefined && (
        <span className="tabular text-micro text-text-faint">{count}</span>
      )}
    </button>
  )
}

/**
 * Fire `onLoadMore` whenever the sentinel enters the (pre-extended)
 * viewport while loading is allowed. The observer reconnects on every
 * `enabled` flip, so a sentinel that is STILL visible after a fetch
 * settles re-fires — pages keep chaining until the screen is full.
 */
function useAutoLoadMore(enabled: boolean, onLoadMore: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const callbackRef = useRef(onLoadMore)
  callbackRef.current = onLoadMore

  useEffect(() => {
    const el = ref.current
    if (!enabled || el === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          callbackRef.current()
        }
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled])

  return ref
}

/* ── States ───────────────────────────────────────────────────────────── */

function EmptyHint() {
  return (
    <div className="rise-in flex flex-col items-center gap-3 px-6 py-14 text-center">
      <PackageSearch size={32} aria-hidden="true" className="text-text-faint" />
      <p className="max-w-2xs text-body-sm leading-relaxed text-text-muted">
        Search the catalog by name — model numbers and sizes work too.
      </p>
    </div>
  )
}

function NoMatches({
  query,
  inStoreOnly,
  filtersActive,
  onClearFilters,
}: {
  query: string
  inStoreOnly: boolean
  filtersActive: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="rise-in flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-body font-bold">No matches for “{query}”</p>
      <p className="max-w-2xs text-body-sm leading-relaxed text-text-muted">
        {filtersActive
          ? 'Your filters may be too tight for this search.'
          : inStoreOnly
            ? 'Try fewer words, or turn off “Sold in stores” to include online-only items.'
            : 'Try fewer words — the catalog matches product names exactly.'}
      </p>
      {filtersActive && (
        <button
          type="button"
          onClick={onClearFilters}
          className="text-body-sm font-bold text-action"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

function ErrorState({
  message,
  rateLimited,
}: {
  message: string
  rateLimited: boolean
}) {
  return (
    <div className="rise-in flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-body font-bold text-danger">
        {rateLimited ? 'Catalog is busy' : 'Search failed'}
      </p>
      <p className="max-w-2xs text-body-sm leading-relaxed text-text-muted">
        {message}
      </p>
    </div>
  )
}

function LoadingMoreRow() {
  return (
    <output
      aria-label="Loading more results"
      className="flex items-center justify-center gap-2 py-4"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint" />
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint"
        style={{ animationDelay: '300ms' }}
      />
    </output>
  )
}

function SkeletonList() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <li
          key={i}
          className="flex animate-pulse items-center gap-3 rounded-xl bg-surface p-3"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="h-16 w-16 shrink-0 rounded-lg bg-raised" />
          <div className="flex-1">
            <div className="h-3.5 w-4/5 rounded bg-raised" />
            <div className="mt-2 h-3 w-2/5 rounded bg-raised" />
          </div>
          <div className="h-4 w-12 rounded bg-raised" />
        </li>
      ))}
    </ul>
  )
}
