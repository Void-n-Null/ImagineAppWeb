import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ImageOff } from 'lucide-react'
import { formatPrice } from '#/lib/format-price'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import { lookupScannedProduct } from '#/server/functions/lookup-scanned-product'
import { feedbackForResult } from './scan-feedback'
import type { ScanHistoryEntry } from './scan-history'

/**
 * One row in the scan history (IMA-34). Re-resolves the stored scan payload
 * through React Query — keyed by the payload, not the scan time — so re-scanning
 * the same box reuses the cached lookup instead of burning another Best Buy
 * request. A `found` row is a real product card that links to the detail page;
 * everything else is a compact status treatment.
 *
 * These rows NEVER auto-navigate: navigation is a side effect of a fresh scan
 * only (handled at the page level), so re-rendering history — e.g. on
 * back-navigation — never yanks the user off the scanner.
 */
export function ScanHistoryRow({ scan }: { scan: ScanHistoryEntry }) {
  const lookup = useQuery({
    queryKey: ['scan-lookup', scan.format, scan.rawValue],
    queryFn: () =>
      lookupScannedProduct({
        data: { rawValue: scan.rawValue, format: scan.format },
      }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  if (lookup.isPending) {
    return <RowShell scan={scan} status="Looking up…" />
  }
  if (lookup.isError) {
    return (
      <RowShell scan={scan} status="Lookup failed — check connection" danger />
    )
  }

  const result = lookup.data
  if (result.status === 'found') {
    return <ScannedProductCard product={result.product} />
  }

  const feedback = feedbackForResult(result)
  return (
    <RowShell
      scan={scan}
      status={feedback?.message ?? 'Not a product code'}
      danger={feedback?.tone === 'error'}
    />
  )
}

/**
 * A found scan as a product card — compact variant of ProductResultCard
 * (product-search/result-card.tsx). Same "shelf-tag anatomy": image thumbnail,
 * 2-line name clamp, SKU + model in mono, price with sale line. The whole card
 * links to the detail page (IMA-10).
 */
function ScannedProductCard({ product }: { product: BestBuyProduct }) {
  const imageUrl =
    product.image ?? product.mediumImage ?? product.thumbnailImage

  return (
    <li>
      <Link
        to="/product/$sku"
        params={{ sku: String(product.sku) }}
        className="card-glint flex items-center gap-3 rounded-xl bg-surface p-3 transition-transform duration-100 active:scale-[0.99]"
      >
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageOff
              size={20}
              aria-hidden="true"
              className="text-text-faint"
            />
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
          {product.inStoreAvailability === true && (
            <p className="mt-0.5 text-caption font-semibold text-ok">
              Sold in stores
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {product.salePrice !== null ? (
            <>
              <p className="tabular text-body font-bold">
                {formatPrice(product.salePrice)}
              </p>
              {product.onSale && product.regularPrice !== null && (
                <p className="tabular text-caption text-text-faint line-through">
                  {formatPrice(product.regularPrice)}
                </p>
              )}
            </>
          ) : (
            <p className="text-caption text-text-faint">No price</p>
          )}
        </div>
      </Link>
    </li>
  )
}

/**
 * Non-found rows: the raw payload + format stay visible (an employee wants to
 * see exactly what the scanner read), with the status message underneath. No
 * link — there's nothing to open.
 */
function RowShell({
  scan,
  status,
  danger = false,
}: {
  scan: ScanHistoryEntry
  status: string
  danger?: boolean
}) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="break-all font-mono text-caption text-text-muted">
          {scan.rawValue}
        </span>
        <span className="shrink-0 font-mono text-micro uppercase text-text-faint">
          {scan.format.replace(/_/g, ' ')}
        </span>
      </div>
      <span
        className={
          danger
            ? 'text-caption font-semibold text-danger'
            : 'text-caption text-text-faint'
        }
      >
        {status}
      </span>
    </li>
  )
}
