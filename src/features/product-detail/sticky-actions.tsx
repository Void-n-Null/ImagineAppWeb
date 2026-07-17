import { ScanBarcode } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AddToCartButton } from '#/features/cart/add-to-cart-button'
import { formatPrice } from '#/lib/format-price'
import type { BestBuyProduct } from '#/server/bestbuy/types'

/**
 * Sticky quick-action bar (IMA-29). Once the hero's action block scrolls
 * away, the two acts that end a floor conversation — cart and register —
 * plus the price stay pinned on top. Scandit's 2024 associate survey puts
 * "leaving the customer waiting" as the top frustration (68%); scrolling
 * back up through a spec sheet to find the POS button is exactly that.
 *
 * Portaled to <body> (transform-ancestor trap, see pos-sheet.tsx).
 * The sentinel div goes where the hero actions live; the bar shows while
 * it's off-screen above.
 */
export function StickyActions({
  product,
  onOpenPos,
  sentinelRef,
}: {
  product: BestBuyProduct
  onOpenPos: () => void
  sentinelRef: React.RefObject<HTMLDivElement | null>
}) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Only when scrolled PAST (above viewport), not before reaching it.
        setShown(!entry.isIntersecting && entry.boundingClientRect.top < 0)
      },
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinelRef])

  if (!shown || typeof document === 'undefined') return null
  const price = product.salePrice ?? product.regularPrice
  const image = product.thumbnailImage ?? product.image

  return createPortal(
    <div className="slide-down fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)]">
      <div className="chrome-float mx-auto flex max-w-lg items-center gap-3 rounded-b-2xl py-2 pr-2 pl-3">
        {image !== null && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5">
            <img
              src={image}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-semibold">{product.name}</p>
          {price !== null && (
            <p className="tabular text-body-sm font-extrabold">
              {formatPrice(price)}
            </p>
          )}
        </div>
        <AddToCartButton product={product} />
        <button
          type="button"
          onClick={onOpenPos}
          aria-label="Scan into POS"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-action text-action-ink transition-transform duration-100 active:scale-95"
        >
          <ScanBarcode size={16} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  )
}
