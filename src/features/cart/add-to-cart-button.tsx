import { Check, Plus } from 'lucide-react'
import { capture } from '#/features/analytics/analytics'
import { cn } from '#/lib/utils'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import {
  addCartItem,
  cartItemFromProduct,
  removeCartItem,
  useCart,
} from './cart-store'

/**
 * Cart toggle in two sizes (IMA-10/11): `icon` is the compact in-card
 * control (chat rich cards, compare columns); `block` is the detail page's
 * full-width primary action. Solid action fill when in the cart — state
 * readable at arm's length (IMA-DOC-5), never tint-only.
 */
export function AddToCartButton({
  product,
  size = 'icon',
}: {
  product: BestBuyProduct
  size?: 'icon' | 'block'
}) {
  const inCart = useCart().some((item) => item.sku === product.sku)

  const toggle = () => {
    if (inCart) removeCartItem(product.sku)
    else {
      addCartItem(cartItemFromProduct(product))
      capture('cart_added', { sku: product.sku })
    }
  }

  if (size === 'block') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={inCart}
        className={cn(
          'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-body font-bold transition-transform duration-100 active:scale-[0.98]',
          inCart ? 'bg-action-subtle text-action' : 'bg-action text-action-ink',
        )}
      >
        {inCart ? (
          <>
            <Check size={17} strokeWidth={3} aria-hidden="true" />
            In cart — tap to remove
          </>
        ) : (
          <>
            <Plus size={17} aria-hidden="true" />
            Add to cart
          </>
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={inCart ? 'Remove from cart' : 'Add to cart'}
      aria-pressed={inCart}
      className={cn(
        'relative z-[1] flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150',
        inCart
          ? 'bg-action text-action-ink'
          : 'border border-line-strong text-text-muted',
      )}
    >
      {inCart ? (
        <Check size={15} strokeWidth={3} aria-hidden="true" />
      ) : (
        <Plus size={15} aria-hidden="true" />
      )}
    </button>
  )
}
