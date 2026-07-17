import { Check, Sun, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RetailBarcode } from '#/features/barcode/retail-barcode'
import { useWakeLock } from '#/features/barcode/use-wake-lock'
import { formatPrice } from '#/lib/format-price'
import { cn } from '#/lib/utils'
import type { CartItem } from '../cart-store'

/**
 * Scan Mode (IMA-11) — the register workflow, and the reason the cart
 * exists: each item's UPC rendered as a scannable UPC-A/EAN-13, one per
 * card, swiped through while the register scans them off the screen.
 *
 * Register-scanner ergonomics:
 * - dark chrome, white cards: the symbol is the brightest thing on screen
 * - wake lock while open (a sleeping screen mid-transaction is the failure
 *   mode), re-acquired on tab return
 * - scroll-snap carousel: one barcode fully visible at a time, so the
 *   scanner can't catch a neighboring code
 * - tap a card to mark it scanned → auto-advances to the next unscanned
 *   item; the count tracks progress through the transaction
 * - items with no UPC show the SKU large: registers can key that manually
 */
export function ScanMode({
  items,
  onClose,
}: {
  items: CartItem[]
  onClose: () => void
}) {
  const [scanned, setScanned] = useState<ReadonlySet<number>>(new Set())
  const [index, setIndex] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)

  useWakeLock()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const scrollToCard = useCallback((cardIndex: number) => {
    const track = trackRef.current
    const card = track?.children[cardIndex]
    if (card instanceof HTMLElement) {
      card.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      })
    }
  }, [])

  const toggleScanned = (item: CartItem, itemIndex: number) => {
    setScanned((prev) => {
      const next = new Set(prev)
      if (next.has(item.sku)) {
        next.delete(item.sku)
        return next
      }
      next.add(item.sku)
      // Advance to the next unscanned card, wrapping the search forward.
      const order = [
        ...items.slice(itemIndex + 1),
        ...items.slice(0, itemIndex),
      ]
      const target = order.find((candidate) => !next.has(candidate.sku))
      if (target !== undefined) {
        const targetIndex = items.indexOf(target)
        // Let the toggle paint first; then glide.
        requestAnimationFrame(() => scrollToCard(targetIndex))
      }
      return next
    })
  }

  const handleScroll = () => {
    const track = trackRef.current
    if (track === null || track.children.length === 0) return
    const cardWidth = track.scrollWidth / track.children.length
    setIndex(
      Math.max(
        0,
        Math.min(items.length - 1, Math.round(track.scrollLeft / cardWidth)),
      ),
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan mode"
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      <header className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <div>
          <p className="aisle-label">Scan mode</p>
          <p className="tabular text-body-sm font-bold text-text">
            {scanned.size} of {items.length} scanned
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Exit scan mode"
          className="grid h-11 w-11 place-items-center rounded-full bg-raised text-text-muted transition-transform duration-100 active:scale-95"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <p className="flex items-center gap-1.5 px-4 pb-3 text-caption text-text-faint">
        <Sun size={13} aria-hidden="true" />
        Max screen brightness helps the register read the code.
      </p>

      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="scrollbar-none flex min-h-0 flex-1 snap-x snap-mandatory items-center gap-4 overflow-x-auto px-[7.5%]"
      >
        {items.map((item, i) => (
          <ScanCard
            key={item.sku}
            item={item}
            scanned={scanned.has(item.sku)}
            onTap={() => toggleScanned(item, i)}
          />
        ))}
      </div>

      <footer className="flex flex-col items-center gap-2 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-1.5" aria-hidden="true">
          {items.map((item, i) => (
            <span
              key={item.sku}
              className={cn(
                'h-1.5 rounded-full transition-all duration-200',
                i === index ? 'w-5 bg-action' : 'w-1.5 bg-raised',
                scanned.has(item.sku) && i !== index && 'bg-ok',
              )}
            />
          ))}
        </div>
        <p className="text-caption text-text-faint">
          Swipe between items · tap a card when it beeps
        </p>
      </footer>
    </div>
  )
}

function ScanCard({
  item,
  scanned,
  onTap,
}: {
  item: CartItem
  scanned: boolean
  onTap: () => void
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-pressed={scanned}
      aria-label={`${item.name}${scanned ? ' — scanned' : ''}`}
      className={cn(
        'relative w-[85%] shrink-0 snap-center rounded-2xl bg-white p-5 text-left transition-opacity duration-200',
        scanned && 'opacity-50',
      )}
    >
      {scanned && (
        <span className="absolute top-3 right-3 z-[1] grid h-8 w-8 place-items-center rounded-full bg-ok">
          <Check
            size={18}
            strokeWidth={3}
            aria-hidden="true"
            className="text-black"
          />
        </span>
      )}

      <p className="line-clamp-2 pr-8 text-body-sm font-bold leading-snug text-black">
        {item.name}
      </p>
      <p className="tabular mt-0.5 text-body font-extrabold text-black">
        {item.price !== null ? formatPrice(item.price) : 'No price'}
      </p>

      {item.upc !== null ? (
        <div className="mt-4">
          <RetailBarcode upc={item.upc} className="w-full" />
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-black/20 px-4 py-6">
          <p className="text-caption font-semibold text-black/60">
            No barcode — key the SKU at the register
          </p>
          <p className="tabular font-mono text-title font-extrabold tracking-widest text-black">
            {item.sku}
          </p>
        </div>
      )}
    </button>
  )
}
