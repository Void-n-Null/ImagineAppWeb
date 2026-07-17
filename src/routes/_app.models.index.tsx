import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { CircleHelp, Search, X } from 'lucide-react'
import { useMemo, useRef } from 'react'
import {
  applyCapability,
  CAPABILITY_FILTERS,
  CAPABILITY_LABELS,
  type CapabilityFilter,
  isCapabilityFilter,
  isSortMode,
  RECOMMENDED_PICKS,
  SORT_LABELS,
  SORT_MODES,
  type SortMode,
  searchModels,
  sortModels,
  useModelCatalog,
  useSelectedModel,
} from '#/features/models'
import { ModelRow } from '#/features/models/components/model-row'
import { PickCard } from '#/features/models/components/recommended-card'

/**
 * The model browser. Filter state lives in typed URL search params — the
 * back button, reload, and shared links all preserve exactly what you were
 * looking at. The list itself is window-virtualized (340 models, ~10 in the
 * DOM at a time).
 */
export const Route = createFileRoute('/_app/models/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; cap?: CapabilityFilter; sort?: SortMode } => ({
    q:
      typeof search.q === 'string' && search.q.length > 0
        ? search.q
        : undefined,
    cap: isCapabilityFilter(search.cap) ? search.cap : undefined,
    sort: isSortMode(search.sort) ? search.sort : undefined,
  }),
  component: ModelsPage,
})

const DEFAULT_SORT: SortMode = 'newest'

function ModelsPage() {
  const { q, cap, sort } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const catalog = useModelCatalog()
  const { selectedId } = useSelectedModel()

  const models = catalog.data?.models
  const visible = useMemo(() => {
    if (!models) return []
    return sortModels(
      applyCapability(searchModels(models, q ?? ''), cap),
      sort ?? DEFAULT_SORT,
    )
  }, [models, q, cap, sort])

  // Curated picks only greet an unfiltered browse — any intent hides them.
  const browsing = !q && !cap
  const picks = useMemo(() => {
    if (!browsing || !models) return []
    return RECOMMENDED_PICKS.flatMap((pick) => {
      const model = models.find((m) => m.id === pick.id)
      return model ? [{ pick, model }] : []
    })
  }, [browsing, models])

  const setSearch = (
    patch: Partial<{ q?: string; cap?: CapabilityFilter; sort?: SortMode }>,
  ) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
    })

  return (
    <div className="flex flex-col">
      <header className="px-4 pt-6 pb-3">
        <h1 className="text-title font-extrabold tracking-tight">Models</h1>
        <p className="mt-0.5 text-caption text-text-faint">
          {catalog.data
            ? `${catalog.data.models.length} OpenRouter models · live pricing`
            : 'The brains behind every answer'}
        </p>
      </header>

      {/* Sticky controls: search + capability chips. */}
      <div className="sticky top-0 z-10 flex flex-col gap-2.5 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur-sm">
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
          />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Search models by name or slug"
            placeholder="Search models"
            value={q ?? ''}
            onChange={(e) => setSearch({ q: e.target.value || undefined })}
            className="card-glint h-11 w-full rounded-xl bg-raised pr-10 pl-9 text-body-lg text-text placeholder:text-text-faint"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch({ q: undefined })}
              className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-text-muted active:bg-surface"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <nav
          className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4"
          aria-label="Filter by capability"
        >
          <FilterChip label="All" active={!cap} search={{ cap: undefined }} />
          {CAPABILITY_FILTERS.map((value) => (
            <FilterChip
              key={value}
              label={CAPABILITY_LABELS[value]}
              active={cap === value}
              search={{ cap: value }}
            />
          ))}
        </nav>
      </div>

      {catalog.isPending && !catalog.data && <CatalogSkeleton />}

      {catalog.isError && !catalog.data && (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-body font-semibold">Couldn’t load models</p>
          <p className="max-w-xs text-body-sm text-text-muted">
            models.dev and OpenRouter are both unreachable. Check your
            connection and try again.
          </p>
          <button
            type="button"
            onClick={() => catalog.refetch()}
            className="min-h-11 rounded-lg bg-action px-5 text-body-sm font-bold text-action-ink active:scale-[0.98]"
          >
            Retry
          </button>
        </div>
      )}

      {catalog.data && (
        <>
          {picks.length > 0 && (
            <section className="flex flex-col pt-5">
              <div className="flex items-end justify-between gap-3 px-4">
                <div>
                  <p className="aisle-label">The lineup</p>
                  <h2 className="mt-1 text-heading font-extrabold tracking-tight">
                    Three tiers, benchmarked
                  </h2>
                </div>
                <Link
                  to="/models/guide"
                  className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-action-subtle px-3.5 text-caption font-bold text-action transition-transform duration-100 active:scale-[0.97]"
                >
                  <CircleHelp size={14} aria-hidden="true" />
                  Help me choose
                </Link>
              </div>
              {/* Vertical tier ladder (IMA-43): exactly three picks, cheapest
                  first — all visible at once, no rail to swipe. */}
              <div className="flex flex-col gap-3 px-4 pt-3 pb-1">
                {picks.map(({ pick, model }, i) => (
                  <PickCard
                    key={pick.id}
                    pick={pick}
                    model={model}
                    selected={selectedId === model.id}
                    index={i + 1}
                  />
                ))}
              </div>
              <p className="px-4 pt-2 text-caption leading-relaxed text-text-faint">
                Scores from our 53-question floor benchmark — real catalog
                questions with objectively checkable answers, run through the
                full tool loop.{' '}
                <Link to="/bestbuybench" className="font-semibold text-action">
                  See the full benchmark →
                </Link>
              </p>
            </section>
          )}

          <div className="flex items-end justify-between gap-3 px-4 pt-6 pb-2">
            <div>
              <p className="aisle-label">Catalog</p>
              <h2
                className="mt-1 text-heading font-extrabold tracking-tight"
                aria-live="polite"
              >
                {browsing
                  ? 'Every model'
                  : `${visible.length} match${visible.length === 1 ? '' : 'es'}`}
              </h2>
            </div>
            <label className="flex items-center gap-1.5 pb-0.5 text-caption text-text-muted">
              Sort
              <select
                value={sort ?? DEFAULT_SORT}
                onChange={(e) =>
                  setSearch({
                    sort:
                      e.target.value === DEFAULT_SORT
                        ? undefined
                        : (e.target.value as SortMode),
                  })
                }
                className="h-9 rounded-lg bg-raised px-2.5 text-caption font-semibold text-text"
              >
                {SORT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {SORT_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <p className="text-body font-semibold">
                {q ? `Nothing matches “${q}”` : 'No models fit this filter'}
              </p>
              <Link
                to="/models"
                className="text-body-sm font-medium text-action"
              >
                Clear filters
              </Link>
            </div>
          ) : (
            <VirtualModelList models={visible} selectedId={selectedId} />
          )}

          {catalog.data.source !== 'models.dev' && (
            <p className="px-4 py-3 text-caption text-text-faint">
              {catalog.data.source === 'openrouter'
                ? 'models.dev unreachable — showing OpenRouter data (no release dates or cache pricing).'
                : 'Offline — showing the last saved catalog.'}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function FilterChip({
  label,
  active,
  search,
}: {
  label: string
  active: boolean
  search: { cap: CapabilityFilter | undefined }
}) {
  // Soft pills (Lific pattern): tinted fill + text color + weight for the
  // active state — three cues, none of them color-alone.
  return (
    <Link
      from={Route.fullPath}
      search={(prev) => ({ ...prev, cap: search.cap })}
      replace
      aria-current={active ? 'true' : undefined}
      className={`flex h-10 shrink-0 items-center rounded-full px-4 text-body-sm transition-colors duration-150 ${
        active
          ? 'bg-action-subtle font-bold text-action'
          : 'bg-raised font-medium text-text-muted active:bg-surface'
      }`}
    >
      {label}
    </Link>
  )
}

function VirtualModelList({
  models,
  selectedId,
}: {
  models: Array<Parameters<typeof ModelRow>[0]['model']>
  selectedId: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const virtualizer = useWindowVirtualizer({
    count: models.length,
    estimateSize: () => 66,
    overscan: 10,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })

  return (
    <div ref={listRef}>
      <ul
        aria-label="All models"
        className="relative m-0 list-none p-0"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const model = models[item.index]
          return (
            <li
              key={model.id}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <ModelRow model={model} selected={model.id === selectedId} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CatalogSkeleton() {
  return (
    <output
      aria-label="Loading models"
      className="flex flex-col gap-px px-4 pt-4"
    >
      {Array.from({ length: 8 }, (_, i) => `skeleton-${i}`).map((key) => (
        <div
          key={key}
          className="flex min-h-16 animate-pulse items-center gap-3 py-2.5"
        >
          <div className="h-9 w-9 rounded-md bg-raised" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-2/5 rounded bg-raised" />
            <div className="h-3 w-3/5 rounded bg-raised" />
          </div>
          <div className="h-3.5 w-14 rounded bg-raised" />
        </div>
      ))}
    </output>
  )
}
