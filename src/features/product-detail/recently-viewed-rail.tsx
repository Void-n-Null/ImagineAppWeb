import { Link } from '@tanstack/react-router'
import { ImageOff } from 'lucide-react'
import { formatPrice } from '#/lib/format-price'
import { useRecentProducts } from './recently-viewed'

/**
 * "Just viewed" rail (IMA-29) at the bottom of the detail page — the way
 * back to the other products in this conversation. Excludes the SKU being
 * viewed; renders nothing until there's an actual history.
 */
export function RecentlyViewedRail({ currentSku }: { currentSku: number }) {
  const recents = useRecentProducts().filter((item) => item.sku !== currentSku)
  if (recents.length === 0) return null

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="aisle-label">Just viewed</h2>
      <div className="scrollbar-none -mx-5 flex gap-2.5 overflow-x-auto px-5">
        {recents.map((item) => (
          <Link
            key={item.sku}
            to="/product/$sku"
            params={{ sku: String(item.sku) }}
            className="card-glint flex w-32 shrink-0 flex-col gap-1.5 rounded-xl bg-surface p-2.5 transition-transform duration-100 active:scale-[0.97]"
          >
            <span className="flex h-16 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5">
              {item.image ? (
                <img
                  src={item.image}
                  alt=""
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <ImageOff
                  size={16}
                  aria-hidden="true"
                  className="text-text-faint"
                />
              )}
            </span>
            <span className="line-clamp-2 text-caption font-semibold leading-snug">
              {item.name}
            </span>
            {item.price !== null && (
              <span className="tabular text-caption font-bold text-text-muted">
                {formatPrice(item.price)}
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  )
}
