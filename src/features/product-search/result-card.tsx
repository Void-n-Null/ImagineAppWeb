import { Link } from '@tanstack/react-router'
import { ImageOff } from 'lucide-react'
import { formatPrice } from '#/lib/format-price'
import type { BestBuyProduct } from '#/server/bestbuy/types'

/**
 * One product row in search results. Pure display — no fetching. Tapping
 * anywhere opens the product detail page (IMA-10).
 *
 * Designed for the employee, not the shopper (IMA-DOC-5): no ratings or
 * review counts — the identifiers ARE the content. SKU + model number are
 * the two keys printed on the physical shelf tag (and what customers read
 * off screenshots), so the card mirrors the tag the employee is standing
 * in front of. Review volume still drives the invisible result ORDER.
 */
export function ProductResultCard({ product }: { product: BestBuyProduct }) {
  const imageUrl = product.image ?? product.thumbnailImage

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
          {/*
            CHAIN-WIDE flag ("stocked in Best Buy stores", vs online-only) —
            NOT a check against any particular store. Never label this "In
            store": per-store truth requires the Stores API with a store id
            or postal code (IMA-24).
          */}
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
