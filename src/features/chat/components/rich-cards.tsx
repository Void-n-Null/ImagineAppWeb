import { Link } from '@tanstack/react-router'
import { ChevronRight, ImageOff, Search } from 'lucide-react'
import { AddToCartButton } from '#/features/cart/add-to-cart-button'
import { formatPrice } from '#/lib/format-price'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import type { FitVerdictSegment } from '../rich-cards'

/**
 * Rich chat cards (IMA-7) — what [Product(SKU)], [Compare(...)], and
 * [ShowSearch(...)] render as.
 *
 * Same Price Tag anatomy as the search result card (image tile on white,
 * name, mono SKU · model, price column) so a product looks identical
 * whether search found it or the agent recommended it. Employee-first
 * (IMA-DOC-5): identifiers are the content; ratings live in the agent's
 * prose, not the card.
 *
 * Card taps land on the in-app detail page (IMA-10); the compare strip
 * links into the full side-by-side view. bestbuy.com remains reachable
 * from the detail page, not from here.
 */

export function ProductRichCard({ product }: { product: BestBuyProduct }) {
  const imageUrl = product.image ?? product.thumbnailImage

  return (
    <div className="card-glint relative flex items-center gap-3 rounded-xl bg-surface p-3">
      <Link
        to="/product/$sku"
        params={{ sku: String(product.sku) }}
        className="absolute inset-0 rounded-xl"
      >
        <span className="sr-only">{product.name} details</span>
      </Link>

      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <ImageOff size={20} aria-hidden="true" className="text-text-faint" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-body-sm font-semibold leading-snug">
          {product.name}
        </p>
        <p className="mt-1 truncate font-mono text-caption text-text-muted">
          <span className="text-text-faint">SKU </span>
          {product.sku}
          {product.modelNumber !== null && (
            <>
              <span className="text-text-faint"> · </span>
              {product.modelNumber}
            </>
          )}
        </p>
        {/* Chain-wide catalog flag — NOT a per-store stock check (IMA-24). */}
        {product.inStoreAvailability === true && (
          <p className="mt-0.5 text-caption font-semibold text-ok">
            Sold in stores
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <PriceBlock product={product} />
        <AddToCartButton product={product} />
      </div>
    </div>
  )
}

export function FitVerdictCard({ verdict }: { verdict: FitVerdictSegment }) {
  const presentation = fitVerdictPresentation(verdict.percentAny)

  return (
    <div className="card-glint relative overflow-hidden rounded-xl bg-surface p-3 transition-transform duration-100 active:scale-[0.99]">
      <Link
        to="/product/$sku"
        params={{ sku: String(verdict.sku) }}
        className="absolute inset-0 rounded-xl"
      >
        <span className="sr-only">View product details</span>
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="aisle-label">Vehicle fit</p>
          <p className="mt-1 text-heading font-bold">{presentation.headline}</p>
        </div>
        {verdict.estimated && (
          <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-micro font-bold text-text-muted">
            estimated specs
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3">
        <p
          className={`tabular text-display font-extrabold tracking-tight ${presentation.textClass}`}
        >
          {verdict.percentAny}%
        </p>
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold">
            {verdict.vehicleLabel}
          </p>
          <span
            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-micro font-bold ${presentation.badgeClass}`}
          >
            {orientationLabel(verdict.recommended)}
          </span>
        </div>
      </div>

      <FitCrossSection verdict={verdict} toneClass={presentation.textClass} />

      <p className="mt-2.5 text-caption leading-relaxed text-text-muted">
        Assumes rear seats folded. Panels should ride upright; flat transport
        risks damage.
      </p>
    </div>
  )
}

function fitVerdictPresentation(percentAny: number) {
  if (percentAny >= 85) {
    return {
      headline: 'Should fit',
      textClass: 'text-ok',
      badgeClass: 'bg-ok-subtle text-ok',
    }
  }
  if (percentAny >= 15) {
    return {
      headline: 'Tight, measure first',
      textClass: 'text-action',
      badgeClass: 'bg-action-subtle text-action',
    }
  }
  return {
    headline: 'Very unlikely to fit',
    textClass: 'text-danger',
    badgeClass: 'bg-danger-subtle text-danger',
  }
}

export function orientationLabel(
  recommended: FitVerdictSegment['recommended'],
): string {
  switch (recommended) {
    case 'upright':
      return 'loads upright'
    case 'tilted':
      return 'loads tilted'
    case 'flat':
      return 'flat only, not recommended'
    case 'none':
      return 'none'
  }
}

/**
 * The angle the box cross-section is actually drawn at, measured from
 * upright. Not decoration: for the tilted orientation this solves for the
 * smallest lean whose rotated bounding box fits the aperture, matching the
 * geometry engine's rotated-containment predicate. Returns 0 when upright
 * (or when nothing fits, so the overflow is drawn honestly), 90 for flat.
 */
export function crossSectionTiltDegrees(
  verdict: Pick<
    FitVerdictSegment,
    'recommended' | 'boxH' | 'boxD' | 'openW' | 'openH'
  >,
): number {
  if (verdict.recommended === 'upright' || verdict.recommended === 'none') {
    return 0
  }
  if (verdict.recommended === 'flat') return 90
  for (let degrees = 0; degrees <= 90; degrees += 1) {
    const radians = (degrees * Math.PI) / 180
    const width =
      verdict.boxD * Math.cos(radians) + verdict.boxH * Math.sin(radians)
    const height =
      verdict.boxD * Math.sin(radians) + verdict.boxH * Math.cos(radians)
    if (width <= verdict.openW && height <= verdict.openH) return degrees
  }
  return 0
}

export function FitCrossSection({
  verdict,
  toneClass,
}: {
  verdict: FitVerdictSegment
  toneClass: string
}) {
  const rotation = crossSectionTiltDegrees(verdict)
  const radians = (rotation * Math.PI) / 180
  // Bounding box of the rotated cross-section; drives both the fit scale
  // and whether the drawing honestly overflows the aperture.
  const boxWidth =
    verdict.boxD * Math.cos(radians) + verdict.boxH * Math.sin(radians)
  const boxHeight =
    verdict.boxD * Math.sin(radians) + verdict.boxH * Math.cos(radians)
  const scale = Math.min(
    172 / Math.max(verdict.openW, boxWidth),
    82 / Math.max(verdict.openH, boxHeight),
  )
  const centerX = 100
  const centerY = 52
  const openingWidth = verdict.openW * scale
  const openingHeight = verdict.openH * scale
  const renderedBoxWidth = verdict.boxD * scale
  const renderedBoxHeight = verdict.boxH * scale

  return (
    <div className="mt-3 rounded-lg bg-raised px-2 py-1.5">
      <svg
        viewBox="0 0 200 132"
        className="h-32 w-full"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          x={centerX - openingWidth / 2}
          y={centerY - openingHeight / 2}
          width={openingWidth}
          height={openingHeight}
          rx="3"
          fill="none"
          className="stroke-line-strong"
          strokeWidth="2"
        />
        <rect
          x={centerX - renderedBoxWidth / 2}
          y={centerY - renderedBoxHeight / 2}
          width={renderedBoxWidth}
          height={renderedBoxHeight}
          rx="2"
          transform={
            rotation === 0
              ? undefined
              : `rotate(${rotation} ${centerX} ${centerY})`
          }
          className={`fill-current/20 stroke-current ${toneClass}`}
          strokeWidth="2"
        />
        <text
          x="100"
          y="112"
          textAnchor="middle"
          className="fill-text-faint text-[9px]"
        >
          Opening {formatDimension(verdict.openW)} ×{' '}
          {formatDimension(verdict.openH)} in
        </text>
        <text
          x="100"
          y="125"
          textAnchor="middle"
          className="fill-text-faint text-[9px]"
        >
          Box {formatDimension(verdict.boxD)} × {formatDimension(verdict.boxH)}{' '}
          in
          {rotation > 0 && rotation < 90 ? `, leaned ${rotation}°` : ''}
        </text>
      </svg>
    </div>
  )
}

function formatDimension(value: number): string {
  return value.toFixed(1)
}

function PriceBlock({ product }: { product: BestBuyProduct }) {
  if (product.salePrice === null) {
    return <p className="text-caption text-text-faint">No price</p>
  }
  return (
    <div className="text-right">
      <p className="tabular text-body font-bold">
        {formatPrice(product.salePrice)}
      </p>
      {product.onSale && product.regularPrice !== null && (
        <p className="tabular text-caption text-text-faint line-through">
          {formatPrice(product.regularPrice)}
        </p>
      )}
    </div>
  )
}

/**
 * [Compare(...)] — a compact side-by-side strip, horizontally scrollable
 * for 3-5 products on a phone. The strip is the at-a-glance anchor (the
 * model's prose carries the diff); "Full comparison" opens the IMA-10
 * side-by-side page with the same SKUs.
 */
export function CompareRichCard({
  skus,
  products,
}: {
  skus: number[]
  products: ReadonlyMap<number, BestBuyProduct>
}) {
  const resolved = skus
    .map((sku) => products.get(sku))
    .filter((p): p is BestBuyProduct => p !== undefined)
  const missing = skus.filter((sku) => !products.has(sku))

  if (resolved.length === 0) {
    return <MissingProductNote skus={skus} />
  }

  return (
    <div className="card-glint rounded-xl bg-surface p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="aisle-label">Side by side</p>
        {resolved.length >= 2 && (
          <Link
            to="/compare"
            search={{ skus: resolved.map((p) => p.sku).join(',') }}
            className="flex items-center gap-0.5 text-caption font-bold text-action"
          >
            Full comparison
            <ChevronRight size={13} aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto">
        {resolved.map((product) => (
          <CompareCell key={product.sku} product={product} />
        ))}
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-caption text-text-faint">
          Not in the catalog: SKU {missing.join(', ')}
        </p>
      )}
    </div>
  )
}

function CompareCell({ product }: { product: BestBuyProduct }) {
  const imageUrl = product.image ?? product.thumbnailImage
  return (
    <Link
      to="/product/$sku"
      params={{ sku: String(product.sku) }}
      className="w-36 shrink-0 rounded-lg bg-raised p-2.5"
    >
      <div className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-white p-1.5">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <ImageOff size={18} aria-hidden="true" className="text-text-faint" />
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-caption font-semibold leading-snug">
        {product.name}
      </p>
      <p className="tabular mt-1 text-body-sm font-bold">
        {product.salePrice !== null ? formatPrice(product.salePrice) : '—'}
      </p>
      <p className="truncate font-mono text-caption text-text-faint">
        {product.sku}
      </p>
    </Link>
  )
}

/**
 * [ShowSearch(...)] — hands the reins to the human: opens Product Search
 * pre-filled, where infinite scroll and the sold-in-stores filter live.
 */
export function SearchRichCard({ query }: { query: string }) {
  return (
    <Link
      to="/search"
      search={{ q: query }}
      className="card-glint flex items-center gap-3 rounded-xl bg-surface p-3"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-action-subtle text-action">
        <Search size={17} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-semibold">
          Browse “{query}”
        </span>
        <span className="block text-caption text-text-muted">
          Open in Product Search
        </span>
      </span>
      <ChevronRight
        size={16}
        aria-hidden="true"
        className="shrink-0 text-text-faint"
      />
    </Link>
  )
}

/**
 * A referenced SKU the batch lookup couldn't resolve. Loud enough to
 * notice (the model may have hallucinated a SKU — that's signal), quiet
 * enough not to derail the conversation.
 */
export function MissingProductNote({ skus }: { skus: number[] }) {
  return (
    <p className="rounded-xl border border-dashed border-line px-3.5 py-2.5 text-caption text-text-faint">
      SKU {skus.join(', ')} — not in today's catalog
    </p>
  )
}

/** Pulse placeholder while the card's product data is in flight. */
export function ProductCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex animate-pulse items-center gap-3 rounded-xl bg-surface p-3"
    >
      <div className="h-16 w-16 shrink-0 rounded-lg bg-raised" />
      <div className="flex-1">
        <div className="h-3.5 w-4/5 rounded bg-raised" />
        <div className="mt-2 h-3 w-2/5 rounded bg-raised" />
      </div>
      <div className="h-4 w-12 rounded bg-raised" />
    </div>
  )
}
