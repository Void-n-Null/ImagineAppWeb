import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  useCanGoBack,
  useRouter,
} from '@tanstack/react-router'
import { ChevronLeft, ImageOff, Scale } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BestBuyAttribution } from '#/features/about/bestbuy-attribution'
import { capture } from '#/features/analytics/analytics'
import { AddToCartButton } from '#/features/cart/add-to-cart-button'
import { buildComparison } from '#/features/comparison/engine'
import { formatPrice } from '#/lib/format-price'
import { cn } from '#/lib/utils'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import { getProductsBatch } from '#/server/functions/get-products-batch'

/**
 * Side-by-side comparison (IMA-10) — 2-5 SKUs from the URL, so the chat's
 * [Compare(...)] strip, shared links, and the back button all land on the
 * same view. Label column pins left; product columns scroll horizontally
 * on a phone.
 */
export const Route = createFileRoute('/_app/compare')({
  validateSearch: (search: Record<string, unknown>): { skus: string } => ({
    skus: typeof search.skus === 'string' ? search.skus : '',
  }),
  component: ComparePage,
})

function parseSkus(raw: string): number[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isSafeInteger(n) && n > 0),
    ),
  ].slice(0, 5)
}

function ComparePage() {
  const { skus: rawSkus } = Route.useSearch()
  const skus = useMemo(() => parseSkus(rawSkus), [rawSkus])
  const [differencesOnly, setDifferencesOnly] = useState(false)

  useEffect(() => {
    if (skus.length < 2) return
    capture('compare_used', { sku_count: skus.length })
  }, [skus])

  const batch = useQuery({
    queryKey: ['compare-products', skus],
    enabled: skus.length >= 2,
    queryFn: () => getProductsBatch({ data: { skus } }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })

  return (
    <div className="flex flex-col gap-4 px-5 pt-3">
      <CompareHeader />

      {skus.length < 2 ? (
        <EmptyState />
      ) : batch.isPending ? (
        <CompareSkeleton columns={skus.length} />
      ) : batch.data?.status === 'ok' && batch.data.products.length >= 2 ? (
        <CompareBody
          products={batch.data.products}
          missingSkus={batch.data.missingSkus}
          differencesOnly={differencesOnly}
          setDifferencesOnly={setDifferencesOnly}
        />
      ) : (
        <ErrorState
          message={
            batch.data?.status === 'error'
              ? batch.data.message
              : batch.data?.status === 'ok'
                ? 'Fewer than two of those SKUs are in today’s catalog.'
                : 'Comparison failed — try again.'
          }
        />
      )}
    </div>
  )
}

function CompareHeader() {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Back"
        onClick={() => {
          if (canGoBack) router.history.back()
          else void router.navigate({ to: '/chat', search: {} })
        }}
        className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-text-muted active:bg-action-subtle"
      >
        <ChevronLeft size={22} aria-hidden="true" />
      </button>
      <div>
        <p className="aisle-label">Side by side</p>
        <h1 className="text-title font-extrabold tracking-tight">Compare</h1>
      </div>
      {/* Required source mark, top corner: every column of the table is
          Best Buy API data. */}
      <BestBuyAttribution className="ml-auto" />
    </div>
  )
}

/* ── Table ──────────────────────────────────────────────────────────────── */

const LABEL_COL = 'sticky left-0 z-[1] w-28 min-w-28 bg-bg pr-2'

function CompareBody({
  products,
  missingSkus,
  differencesOnly,
  setDifferencesOnly,
}: {
  products: BestBuyProduct[]
  missingSkus: number[]
  differencesOnly: boolean
  setDifferencesOnly: (on: boolean) => void
}) {
  const table = useMemo(() => buildComparison(products), [products])
  const rows = differencesOnly
    ? table.rows.filter((row) => row.differs)
    : table.rows

  return (
    <div className="rise-in flex flex-col gap-4 pb-6">
      {missingSkus.length > 0 && (
        <p className="rounded-xl border border-dashed border-line px-3.5 py-2.5 text-caption text-text-faint">
          Not in today’s catalog: SKU {missingSkus.join(', ')}
        </p>
      )}

      {/* ON = solid fill (IMA-DOC-5 state clarity). */}
      <button
        type="button"
        onClick={() => setDifferencesOnly(!differencesOnly)}
        aria-pressed={differencesOnly}
        className={cn(
          'flex min-h-9 w-fit items-center gap-1.5 rounded-full px-3.5 text-caption font-bold transition-colors duration-150',
          differencesOnly
            ? 'bg-action text-action-ink'
            : 'border border-line-strong bg-transparent text-text-faint',
        )}
      >
        <Scale size={14} aria-hidden="true" />
        Differences only
      </button>

      <div className="scrollbar-none -mx-5 overflow-x-auto px-5">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={LABEL_COL} aria-label="Attribute" />
              {table.products.map((product) => (
                <th
                  key={product.sku}
                  className="min-w-36 max-w-44 pb-3 pl-2 text-left align-top font-normal"
                >
                  <ProductColumnHeader product={product} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-line">
                <th
                  scope="row"
                  className={cn(
                    LABEL_COL,
                    'py-2.5 text-left align-top text-caption font-semibold text-text-faint',
                  )}
                >
                  {row.label}
                </th>
                {row.values.map((value, i) => (
                  <td
                    key={table.products[i].sku}
                    className={cn(
                      'py-2.5 pl-2 align-top text-body-sm',
                      value === null && 'text-text-faint',
                      row.differs ? 'font-semibold' : 'text-text-muted',
                      row.bestIndex === i && 'font-bold text-ok',
                    )}
                  >
                    {value ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {differencesOnly && rows.length === 0 && (
        <p className="text-center text-body-sm text-text-muted">
          These match on every attribute we track.
        </p>
      )}

      <FeaturesSection products={table.products} />
    </div>
  )
}

function ProductColumnHeader({ product }: { product: BestBuyProduct }) {
  const imageUrl = product.image ?? product.thumbnailImage
  const price = product.salePrice ?? product.regularPrice

  return (
    <div className="flex flex-col gap-1.5">
      <Link
        to="/product/$sku"
        params={{ sku: String(product.sku) }}
        className="flex flex-col gap-1.5"
      >
        <span className="flex h-20 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageOff
              size={18}
              aria-hidden="true"
              className="text-text-faint"
            />
          )}
        </span>
        <span className="line-clamp-3 text-caption font-semibold leading-snug text-text">
          {product.name}
        </span>
      </Link>
      <span className="flex items-center justify-between gap-2">
        <span className="tabular text-body-sm font-bold">
          {price !== null ? formatPrice(price) : '—'}
        </span>
        <AddToCartButton product={product} />
      </span>
    </div>
  )
}

/**
 * Feature bullets don't align into rows (free text) — per-product lists
 * keep them comparable without pretending they're a table.
 */
function FeaturesSection({ products }: { products: BestBuyProduct[] }) {
  const withFeatures = products.filter((p) => p.features.length > 0)
  if (withFeatures.length === 0) return null
  return (
    <section className="flex flex-col gap-4">
      <h2 className="aisle-label">Key features</h2>
      {withFeatures.map((product) => (
        <div key={product.sku} className="flex flex-col gap-1.5">
          <p className="line-clamp-1 text-body-sm font-bold">{product.name}</p>
          <ul className="flex flex-col gap-1">
            {product.features.slice(0, 5).map((feature) => (
              <li
                key={feature}
                className="flex gap-2 text-caption leading-relaxed text-text-muted"
              >
                <span
                  aria-hidden="true"
                  className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-action"
                />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/* ── States ─────────────────────────────────────────────────────────────── */

function CompareSkeleton({ columns }: { columns: number }) {
  return (
    <output aria-label="Loading comparison" className="flex gap-3">
      {Array.from({ length: Math.min(columns, 3) }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
        <div key={i} className="flex flex-1 animate-pulse flex-col gap-2">
          <div className="h-20 rounded-lg bg-raised" />
          <div className="h-3 w-4/5 rounded bg-raised" />
          <div className="h-3 w-3/5 rounded bg-raised" />
        </div>
      ))}
    </output>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Scale size={32} aria-hidden="true" className="text-text-faint" />
      <p className="text-body font-bold">Nothing to compare yet</p>
      <p className="max-w-2xs text-body-sm leading-relaxed text-text-muted">
        Ask the assistant to compare products, or open a comparison from chat.
      </p>
      <Link
        to="/chat"
        search={{}}
        className="text-body-sm font-bold text-action"
      >
        Open chat
      </Link>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-body font-bold text-danger">Comparison unavailable</p>
      <p className="max-w-2xs text-body-sm leading-relaxed text-text-muted">
        {message}
      </p>
    </div>
  )
}
