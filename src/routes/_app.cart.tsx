import { createFileRoute, Link } from '@tanstack/react-router'
import { ImageOff, ScanBarcode, ShoppingCart, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { BestBuyAttribution } from '#/features/about/bestbuy-attribution'
import {
  type CartItem,
  clearCart,
  removeCartItem,
  useCart,
} from '#/features/cart/cart-store'
import { ScanMode } from '#/features/cart/components/scan-mode'
import { formatPrice } from '#/lib/format-price'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_app/cart')({ component: CartPage })

/**
 * The cart (IMA-11) — a working list for the walk to the register, built
 * up from chat cards, product pages, and agent add_to_cart calls. The
 * headline action is Scan Mode: every UPC on screen, register-scannable.
 *
 * Delete is the same two-tap arm/confirm as the thread drawer — no modals,
 * one-handed floor use.
 */
function CartPage() {
  const items = useCart()
  const [scanMode, setScanMode] = useState(false)
  const [armedSku, setArmedSku] = useState<number | null>(null)
  const [clearArmed, setClearArmed] = useState(false)

  const subtotal = items.reduce((sum, item) => sum + (item.price ?? 0), 0)
  const unpriced = items.filter((item) => item.price === null).length

  return (
    <div className="flex flex-col gap-4 px-5 pt-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="aisle-label">Register list</p>
          <h1 className="text-title font-extrabold tracking-tight">Cart</h1>
        </div>
        <div className="flex items-center gap-1">
          {/* Required source mark, top corner: cart rows carry Best Buy
              catalog data. */}
          <BestBuyAttribution />
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (clearArmed) {
                  clearCart()
                  setClearArmed(false)
                } else {
                  setClearArmed(true)
                  setArmedSku(null)
                }
              }}
              onBlur={() => setClearArmed(false)}
              className={cn(
                'min-h-9 rounded-full px-3.5 text-caption font-bold transition-colors duration-150',
                clearArmed
                  ? 'bg-danger-subtle text-danger'
                  : 'text-text-faint active:bg-raised',
              )}
            >
              {clearArmed ? 'Tap again to clear' : 'Clear all'}
            </button>
          )}
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyCart />
      ) : (
        <div className="rise-in flex flex-col gap-4 pb-4">
          {/* The headline: everything below exists to feed this button. */}
          <button
            type="button"
            onClick={() => setScanMode(true)}
            className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-action text-body font-bold text-action-ink transition-transform duration-100 active:scale-[0.98]"
          >
            <ScanBarcode size={18} aria-hidden="true" />
            Scan at register
          </button>

          <div className="card-glint flex items-baseline justify-between rounded-xl bg-surface px-4 py-3">
            <p className="text-body-sm text-text-muted">
              {items.length} item{items.length === 1 ? '' : 's'}
              {unpriced > 0 && (
                <span className="text-text-faint"> · {unpriced} unpriced</span>
              )}
            </p>
            <p className="tabular text-body-lg font-extrabold">
              {formatPrice(subtotal)}
              <span className="ml-1 text-caption font-semibold text-text-faint">
                subtotal
              </span>
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <CartRow
                key={item.sku}
                item={item}
                armed={armedSku === item.sku}
                onArm={() => {
                  setArmedSku(item.sku)
                  setClearArmed(false)
                }}
                onDelete={() => {
                  removeCartItem(item.sku)
                  setArmedSku(null)
                }}
              />
            ))}
          </ul>

          <p className="text-center text-micro text-text-faint">
            Prices are from when each item was added — the register wins.
          </p>
        </div>
      )}

      {scanMode && items.length > 0 && (
        <ScanMode items={items} onClose={() => setScanMode(false)} />
      )}
    </div>
  )
}

function CartRow({
  item,
  armed,
  onArm,
  onDelete,
}: {
  item: CartItem
  armed: boolean
  onArm: () => void
  onDelete: () => void
}) {
  return (
    <li className="card-glint flex items-center gap-3 rounded-xl bg-surface p-3">
      <Link
        to="/product/$sku"
        params={{ sku: String(item.sku) }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
          {item.image !== null ? (
            <img
              src={item.image}
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
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-body-sm font-semibold leading-snug">
            {item.name}
          </span>
          <span className="mt-0.5 block truncate font-mono text-caption text-text-faint">
            SKU {item.sku}
            {item.modelNumber !== null && ` · ${item.modelNumber}`}
          </span>
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-1">
        <span className="tabular text-body font-bold">
          {item.price !== null ? formatPrice(item.price) : '—'}
        </span>
        <button
          type="button"
          onClick={armed ? onDelete : onArm}
          aria-label={
            armed ? `Confirm remove ${item.name}` : `Remove ${item.name}`
          }
          className={cn(
            'grid h-10 shrink-0 place-items-center rounded-full transition-colors duration-150',
            armed
              ? 'w-auto bg-danger-subtle px-3 text-caption font-bold text-danger'
              : 'w-10 text-text-faint active:bg-raised',
          )}
        >
          {armed ? 'Remove?' : <Trash2 size={16} aria-hidden="true" />}
        </button>
      </div>
    </li>
  )
}

function EmptyCart() {
  return (
    <div className="rise-in flex flex-col items-center gap-4 px-6 py-14 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-action-subtle">
        <ShoppingCart size={26} aria-hidden="true" className="text-action" />
      </div>
      <div>
        <p className="text-body font-bold">Nothing staged yet</p>
        <p className="mx-auto mt-1 max-w-2xs text-body-sm leading-relaxed text-text-muted">
          Add items from chat cards, search, or a product page — then scan them
          all at the register from one screen.
        </p>
      </div>
      <div className="flex gap-2">
        <Link
          to="/search"
          search={{ q: '' }}
          className="min-h-11 rounded-lg bg-action px-5 leading-[2.75rem] text-body-sm font-bold text-action-ink"
        >
          Search products
        </Link>
        <Link
          to="/chat"
          search={{}}
          className="min-h-11 rounded-lg bg-raised px-5 leading-[2.75rem] text-body-sm font-bold text-text-muted"
        >
          Ask the assistant
        </Link>
      </div>
    </div>
  )
}
