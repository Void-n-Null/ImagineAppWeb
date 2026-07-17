import { Check, Copy, ImageOff, Sun, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RetailBarcode } from '#/features/barcode/retail-barcode'
import { useWakeLock } from '#/features/barcode/use-wake-lock'
import type { BestBuyProduct } from '#/server/bestbuy/types'

/**
 * "Scan into POS" (IMA-10 follow-up) — the single-item register handoff.
 * Scan Mode (IMA-11) is the multi-item cart flow; this is the one-tap
 * version for the product you're already looking at: product image so
 * the cashier can eyeball the match, the SKU huge (registers key it
 * manually when scanning fails), and the barcode.
 *
 * Same register ergonomics as Scan Mode: dark chrome so the white card
 * is the brightest thing on screen, wake lock held while open.
 */
export function PosSheet({
  product,
  onClose,
}: {
  product: BestBuyProduct
  onClose: () => void
}) {
  useWakeLock()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const imageUrl = product.image ?? product.thumbnailImage

  // Portaled: the detail page animates sections with `rise-in`, and a
  // retained transform turns any ancestor into the containing block for
  // fixed positioning — the sheet would pin to the page, not the viewport.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan into POS"
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
    >
      <header className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-1">
        <div>
          <p className="aisle-label">Scan into POS</p>
          <p className="flex items-center gap-1.5 text-caption text-text-faint">
            <Sun size={12} aria-hidden="true" />
            Max brightness helps the scanner
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-11 w-11 place-items-center rounded-full bg-raised text-text-muted transition-transform duration-100 active:scale-95"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {/* Backdrop tap closes; the card itself doesn't. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 -z-[1] cursor-default"
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="rise-in w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-white p-1.5">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <ImageOff
                  size={22}
                  aria-hidden="true"
                  className="text-black/30"
                />
              )}
            </div>
            <p className="line-clamp-3 min-w-0 flex-1 text-body-sm font-semibold leading-snug text-black/80">
              {product.name}
            </p>
          </div>

          <BigSku sku={product.sku} />

          {product.upc !== null ? (
            <div className="mt-4">
              <RetailBarcode upc={product.upc} className="w-full" />
            </div>
          ) : (
            <p className="mt-4 rounded-xl border-2 border-dashed border-black/15 px-4 py-4 text-center text-caption font-semibold text-black/50">
              No barcode on file — key the SKU above.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The SKU as the hero: registers key it when a screen scan won't take. */
function BigSku({ sku }: { sku: number }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(String(sku))
          .then(() => {
            setCopied(true)
            if (timer.current !== null) clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => {})
      }}
      aria-label={`Copy SKU ${sku}`}
      className="mt-5 flex w-full flex-col items-center gap-0.5 rounded-2xl bg-black/[0.04] py-3 active:bg-black/[0.08]"
    >
      <span className="flex items-center gap-1.5 text-micro font-bold tracking-[0.14em] text-black/45 uppercase">
        SKU
        {copied ? (
          <Check
            size={11}
            strokeWidth={3}
            aria-hidden="true"
            className="text-ok"
          />
        ) : (
          <Copy size={11} aria-hidden="true" />
        )}
      </span>
      <span className="tabular font-mono text-display font-extrabold tracking-[0.12em] text-black">
        {sku}
      </span>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}
