import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  useCanGoBack,
  useRouter,
} from '@tanstack/react-router'
import {
  ChevronLeft,
  ExternalLink,
  History,
  ImageOff,
  MessageCircle,
  PackageX,
  Scale,
  ScanBarcode,
  Share2,
  Star,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BestBuyAttribution } from '#/features/about/bestbuy-attribution'
import { capture } from '#/features/analytics/analytics'
import { RetailBarcode } from '#/features/barcode/retail-barcode'
import { AddToCartButton } from '#/features/cart/add-to-cart-button'
import { ComparePill } from '#/features/comparison/compare-pill'
import {
  toggleCompareEntry,
  useCompareTray,
} from '#/features/comparison/compare-tray'
import { CopyChip, CopyQuoteChip } from '#/features/product-detail/copy-chip'
import { buildCustomerQuote } from '#/features/product-detail/customer-quote'
import { JumpRail } from '#/features/product-detail/jump-rail'
import { PosSheet } from '#/features/product-detail/pos-sheet'
import { recordProductView } from '#/features/product-detail/recently-viewed'
import { RecentlyViewedRail } from '#/features/product-detail/recently-viewed-rail'
import {
  DescriptionSection,
  FeatureList,
  IncludedItems,
} from '#/features/product-detail/sections'
import { SpecSection } from '#/features/product-detail/spec-section'
import { StickyActions } from '#/features/product-detail/sticky-actions'
import { StoreAvailabilitySection } from '#/features/product-detail/store-availability'
import { formatPrice } from '#/lib/format-price'
import { cn } from '#/lib/utils'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import { getProductDetail } from '#/server/functions/get-product-detail'

export const Route = createFileRoute('/_app/product/$sku')({
  component: ProductDetailPage,
})

/**
 * Product detail (IMA-10) — v1's 1,503-line product_detail_page.dart,
 * decomposed. Ordered for the floor conversation: price + availability
 * answer first, actions next, research material below.
 *
 * Data rides the same entity-keyed Redis path as every other lookup
 * (detail costs the same as any SKU fetch — the DTO is already the full
 * superset).
 */
function ProductDetailPage() {
  const { sku } = Route.useParams()
  const skuNumber = Number(sku)
  const validSku = Number.isSafeInteger(skuNumber) && skuNumber > 0

  const detail = useQuery({
    queryKey: ['product-detail', skuNumber],
    enabled: validSku,
    queryFn: () => getProductDetail({ data: { sku: skuNumber } }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })

  return (
    <div className="flex flex-col gap-5 px-5 pt-3">
      <DetailHeader
        productUrl={
          detail.data?.status === 'found' ? detail.data.product.url : null
        }
        productName={
          detail.data?.status === 'found' ? detail.data.product.name : null
        }
      />

      {!validSku || detail.data?.status === 'not_found' ? (
        <NotFound sku={sku} />
      ) : detail.isPending ? (
        <DetailSkeleton />
      ) : detail.data?.status === 'error' ? (
        <ErrorState message={detail.data.message} />
      ) : detail.data?.status === 'found' ? (
        <ProductBody product={detail.data.product} />
      ) : (
        <ErrorState message="Couldn’t load this product — try again." />
      )}
    </div>
  )
}

/* ── Header ─────────────────────────────────────────────────────────────── */

function DetailHeader({
  productUrl,
  productName,
}: {
  productUrl: string | null
  productName: string | null
}) {
  const router = useRouter()
  const canGoBack = useCanGoBack()

  const share = () => {
    if (productName === null) return
    void navigator
      .share?.({
        title: productName,
        url: productUrl ?? window.location.href,
      })
      .catch(() => {}) // user dismissed the sheet
  }

  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        aria-label="Back"
        onClick={() => {
          if (canGoBack) router.history.back()
          else void router.navigate({ to: '/search', search: { q: '' } })
        }}
        className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-text-muted active:bg-action-subtle"
      >
        <ChevronLeft size={22} aria-hidden="true" />
      </button>

      <div className="-mr-2 flex items-center">
        {/* Required source mark, top corner: this whole page is Best Buy
            API data. */}
        <BestBuyAttribution />
        {typeof navigator !== 'undefined' &&
          typeof navigator.share === 'function' &&
          productName !== null && (
            <button
              type="button"
              aria-label="Share product"
              onClick={share}
              className="grid h-11 w-11 place-items-center rounded-full text-text-muted active:bg-action-subtle"
            >
              <Share2 size={18} aria-hidden="true" />
            </button>
          )}
      </div>
    </div>
  )
}

/* ── Body ───────────────────────────────────────────────────────────────── */

function ProductBody({ product }: { product: BestBuyProduct }) {
  const [posOpen, setPosOpen] = useState(false)
  const actionsSentinelRef = useRef<HTMLDivElement>(null)
  const heroImage =
    product.largeImage ?? product.image ?? product.mediumImage ?? null
  const brandLine = [
    product.manufacturer,
    product.categoryPath.at(-1)?.name,
  ].filter(Boolean)

  // "Just viewed" history (IMA-29) — record once per product landing.
  useEffect(() => {
    recordProductView(product)
  }, [product])

  useEffect(() => {
    capture('product_opened', {
      sku: product.sku,
      name: product.name,
      source: 'product_page',
    })
  }, [product.name, product.sku])

  // Jump chips only for sections this product actually renders.
  const jumpTargets = [
    { id: 'section-stores', label: 'Stores' },
    ...(product.shortDescription !== null || product.longDescription !== null
      ? [{ id: 'section-about', label: 'About' }]
      : []),
    ...(product.features.length > 0
      ? [{ id: 'section-features', label: 'Features' }]
      : []),
    { id: 'section-specs', label: 'Specs' },
    ...(product.includedItemList.length > 0
      ? [{ id: 'section-box', label: 'In the box' }]
      : []),
    ...(product.upc !== null
      ? [{ id: 'section-barcode', label: 'Barcode' }]
      : []),
  ]

  return (
    <div className="rise-in flex flex-col gap-6 pb-6">
      {/* Hero */}
      <div className="flex flex-col gap-4">
        <div className="flex aspect-square max-h-72 items-center justify-center self-center overflow-hidden rounded-2xl bg-white p-6">
          {heroImage ? (
            <img
              src={heroImage}
              alt={product.name}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageOff
              size={40}
              aria-hidden="true"
              className="text-text-faint"
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {brandLine.length > 0 && (
            <p className="aisle-label">{brandLine.join(' · ')}</p>
          )}
          <h1 className="text-heading font-extrabold leading-snug tracking-tight">
            {product.name}
          </h1>
          <RatingLine product={product} />
        </div>

        <PriceBlock product={product} />
        <StaleNotice product={product} />
        <AvailabilityFlags product={product} />

        <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5">
          <CopyChip label="SKU" value={String(product.sku)} />
          {product.modelNumber !== null && (
            <CopyChip label="Model" value={product.modelNumber} />
          )}
          {product.upc !== null && <CopyChip label="UPC" value={product.upc} />}
          <CopyQuoteChip buildText={() => buildCustomerQuote(product)} />
        </div>

        <div className="flex flex-col gap-2">
          <AddToCartButton product={product} size="block" />
          {/* The one-item register handoff — Scan Mode's single sibling. */}
          <button
            type="button"
            onClick={() => setPosOpen(true)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-raised text-body font-bold text-text transition-transform duration-100 active:scale-[0.98]"
          >
            <ScanBarcode size={17} aria-hidden="true" />
            Scan into POS
          </button>
          <div className="grid grid-cols-2 gap-2">
            <CompareToggle product={product} />
            <Link
              to="/chat"
              search={{ sku: product.sku }}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-raised text-body-sm font-bold text-text transition-transform duration-100 active:scale-[0.98]"
            >
              <MessageCircle
                size={15}
                aria-hidden="true"
                className="text-action"
              />
              Ask assistant
            </Link>
          </div>
        </div>
        {/* Sticky-bar sentinel: the bar shows once this scrolls off the top. */}
        <div ref={actionsSentinelRef} aria-hidden="true" className="h-px" />

        <JumpRail targets={jumpTargets} />

        {product.url !== null && (
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-body-sm font-semibold text-text-muted"
          >
            View on bestbuy.com
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>

      <div id="section-stores" className="scroll-mt-20">
        <StoreAvailabilitySection sku={product.sku} />
      </div>
      <div id="section-about" className="scroll-mt-20">
        <DescriptionSection product={product} />
      </div>
      <div id="section-features" className="scroll-mt-20">
        <FeatureList features={product.features} />
      </div>
      <div id="section-specs" className="scroll-mt-20">
        <SpecSection product={product} />
      </div>
      <div id="section-box" className="scroll-mt-20">
        <IncludedItems items={product.includedItemList} />
      </div>
      <div id="section-barcode" className="scroll-mt-20">
        <BarcodeSection upc={product.upc} onEscalate={() => setPosOpen(true)} />
      </div>

      <RecentlyViewedRail currentSku={product.sku} />

      <StickyActions
        product={product}
        onOpenPos={() => setPosOpen(true)}
        sentinelRef={actionsSentinelRef}
      />
      <ComparePill />

      {posOpen && (
        <PosSheet product={product} onClose={() => setPosOpen(false)} />
      )}
    </div>
  )
}

/** Compare-tray toggle (IMA-29): solid tint when queued, like every other
 *  ON state in the app (IMA-DOC-5 — never tint-only… state also changes
 *  the label text). */
function CompareToggle({ product }: { product: BestBuyProduct }) {
  const queued = useCompareTray().some((entry) => entry.sku === product.sku)
  return (
    <button
      type="button"
      aria-pressed={queued}
      onClick={() => toggleCompareEntry(product)}
      className={cn(
        'flex min-h-11 items-center justify-center gap-2 rounded-xl text-body-sm font-bold transition-transform duration-100 active:scale-[0.98]',
        queued ? 'bg-action-subtle text-action' : 'bg-raised text-text',
      )}
    >
      <Scale
        size={15}
        aria-hidden="true"
        className={queued ? undefined : 'text-action'}
      />
      {queued ? 'In comparison' : 'Compare'}
    </button>
  )
}

/**
 * Stale-data honesty (IMA-29 + IMA-24 doctrine): when the DTO was
 * grace-served from an expired envelope, say so and offer a refresh —
 * an employee quoting yesterday's price without knowing it is the exact
 * "makes me look uninformed" failure DOC-13 catalogs.
 */
function StaleNotice({ product }: { product: BestBuyProduct }) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  if (product.stale !== true) return null

  return (
    <button
      type="button"
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true)
        void queryClient
          .invalidateQueries({ queryKey: ['product-detail', product.sku] })
          .finally(() => setRefreshing(false))
      }}
      className="flex w-fit items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-caption font-semibold text-text-muted active:scale-[0.98]"
    >
      <History
        size={12}
        aria-hidden="true"
        className={refreshing ? 'animate-spin' : undefined}
      />
      {refreshing
        ? 'Refreshing…'
        : 'Prices from earlier today — tap to refresh'}
    </button>
  )
}

function RatingLine({ product }: { product: BestBuyProduct }) {
  if (product.customerReviewAverage === null) return null
  return (
    <p className="flex items-center gap-1 text-body-sm text-text-muted">
      <Star
        size={13}
        aria-hidden="true"
        className="fill-current text-text-muted"
      />
      <span className="tabular font-bold text-text">
        {product.customerReviewAverage.toFixed(1)}
      </span>
      <span className="text-text-faint">
        ({(product.customerReviewCount ?? 0).toLocaleString()} reviews)
      </span>
    </p>
  )
}

function PriceBlock({ product }: { product: BestBuyProduct }) {
  const current = product.salePrice ?? product.regularPrice
  if (current === null) {
    return <p className="text-body text-text-faint">No price listed</p>
  }
  const saving =
    product.onSale && product.regularPrice !== null
      ? product.regularPrice - current
      : 0

  return (
    <div className="flex items-baseline gap-3">
      <p className="tabular text-display font-extrabold tracking-tight">
        {formatPrice(current)}
      </p>
      {saving > 0 && product.regularPrice !== null && (
        <div className="flex flex-col">
          <p className="tabular text-body-sm text-text-faint line-through">
            {formatPrice(product.regularPrice)}
          </p>
          <p className="tabular text-body-sm font-bold text-ok">
            Save {formatPrice(saving)}
            {product.percentSavings !== null &&
              product.percentSavings >= 1 &&
              ` (${Math.round(product.percentSavings)}%)`}
          </p>
        </div>
      )}
    </div>
  )
}

function AvailabilityFlags({ product }: { product: BestBuyProduct }) {
  const flags: string[] = []
  // Chain-wide catalog flag — NOT a per-store stock check (IMA-24).
  if (product.inStoreAvailability === true) flags.push('Sold in stores')
  if (product.onlineAvailability === true) flags.push('Online')
  if (product.freeShipping === true) flags.push('Free shipping')
  if (product.condition !== null && product.condition.toLowerCase() !== 'new')
    flags.push(product.condition)
  if (flags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((flag) => (
        <span
          key={flag}
          className="rounded-full bg-ok-subtle px-2.5 py-1 text-micro font-bold text-ok"
        >
          {flag}
        </span>
      ))}
    </div>
  )
}

/**
 * On-page barcode (v1 parity): scan-verify against the shelf tag. Styled
 * as the tag itself — a compact white card, not an edge-to-edge slab.
 * Tapping escalates to the POS sheet (IMA-29): if you're presenting this
 * card to a scanner, you want the full-brightness, wake-locked version.
 */
function BarcodeSection({
  upc,
  onEscalate,
}: {
  upc: string | null
  onEscalate: () => void
}) {
  if (upc === null) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="aisle-label">Barcode</h2>
      <button
        type="button"
        onClick={onEscalate}
        aria-label="Open full-screen scan view"
        className="card-glint mx-auto w-full max-w-72 rounded-2xl bg-white px-5 py-4 transition-transform duration-100 active:scale-[0.98]"
      >
        <RetailBarcode upc={upc} className="w-full" />
      </button>
      <p className="text-center text-micro text-text-faint">
        Tap for the full-brightness register view
      </p>
    </section>
  )
}

/* ── States ─────────────────────────────────────────────────────────────── */

function DetailSkeleton() {
  return (
    <output aria-label="Loading product" className="flex flex-col gap-4">
      <div className="aspect-square max-h-72 animate-pulse self-center rounded-2xl bg-raised" />
      <div className="h-3 w-24 animate-pulse rounded bg-raised" />
      <div className="h-5 w-4/5 animate-pulse rounded bg-raised" />
      <div className="h-8 w-28 animate-pulse rounded bg-raised" />
      <div className="h-12 w-full animate-pulse rounded-xl bg-raised" />
    </output>
  )
}

function NotFound({ sku }: { sku: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <PackageX size={32} aria-hidden="true" className="text-text-faint" />
      <p className="text-body font-bold">SKU {sku} isn’t in today’s catalog</p>
      <p className="max-w-2xs text-body-sm leading-relaxed text-text-muted">
        It may be discontinued or marketplace-only.
      </p>
      <Link
        to="/search"
        search={{ q: '' }}
        className="text-body-sm font-bold text-action"
      >
        Search the catalog
      </Link>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-body font-bold text-danger">Couldn’t load product</p>
      <p className="max-w-2xs text-body-sm leading-relaxed text-text-muted">
        {message}
      </p>
    </div>
  )
}
