/**
 * Cart data layer (IMA-6 tools; IMA-11 builds the UI on this).
 *
 * Same reactive-storage idiom as models/selected-model.ts: localStorage + a
 * same-tab event + the native
 * cross-tab `storage` event, consumed through useSyncExternalStore.
 *
 * Replaces v1's CartService (dart:io JSON file). Items store a display
 * snapshot (name/price/image) so the cart renders instantly offline; SKU is
 * the identity.
 */

import { useSyncExternalStore } from 'react'
import type { BestBuyProduct } from '#/server/bestbuy/types'

export const CART_STORAGE = 'imagine:cart'
export const CART_EVENT = 'imagine:cart-changed'

export interface CartItem {
  sku: number
  name: string
  price: number | null
  manufacturer: string | null
  modelNumber: string | null
  upc: string | null
  image: string | null
  addedAt: number
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

const EMPTY: CartItem[] = []

// useSyncExternalStore needs referentially-stable snapshots; cache the parse
// keyed by the raw string so unrelated re-renders don't loop.
let lastRaw: string | null = null
let lastParsed: CartItem[] = EMPTY

function parseItems(raw: string | null): CartItem[] {
  if (raw === null) return EMPTY
  if (raw === lastRaw) return lastParsed
  try {
    const parsed = JSON.parse(raw) as unknown
    const items = Array.isArray(parsed)
      ? parsed.filter(
          (item): item is CartItem =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as CartItem).sku === 'number' &&
            typeof (item as CartItem).name === 'string',
        )
      : EMPTY
    lastRaw = raw
    lastParsed = items
    return items
  } catch {
    return EMPTY
  }
}

export function getCartItems(): CartItem[] {
  if (!isBrowser()) return EMPTY
  return parseItems(localStorage.getItem(CART_STORAGE))
}

function writeItems(items: CartItem[]): void {
  if (!isBrowser()) return
  localStorage.setItem(CART_STORAGE, JSON.stringify(items))
  window.dispatchEvent(new Event(CART_EVENT))
}

export function cartItemFromProduct(product: BestBuyProduct): CartItem {
  return {
    sku: product.sku,
    name: product.name,
    price: product.salePrice ?? product.regularPrice,
    manufacturer: product.manufacturer,
    modelNumber: product.modelNumber,
    upc: product.upc,
    image: product.image ?? product.thumbnailImage,
    addedAt: Date.now(),
  }
}

/** Add (idempotent by SKU). Returns false when the SKU was already present. */
export function addCartItem(item: CartItem): boolean {
  const items = getCartItems()
  if (items.some((existing) => existing.sku === item.sku)) return false
  writeItems([...items, item])
  return true
}

/** Remove by SKU. Returns the removed item, or null when absent. */
export function removeCartItem(sku: number): CartItem | null {
  const items = getCartItems()
  const removed = items.find((item) => item.sku === sku) ?? null
  if (removed) writeItems(items.filter((item) => item.sku !== sku))
  return removed
}

/** Empty the cart. Returns how many items were removed. */
export function clearCart(): number {
  const count = getCartItems().length
  if (count > 0) writeItems([])
  return count
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CART_STORAGE) onChange()
  }
  window.addEventListener(CART_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(CART_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, getCartItems, () => EMPTY)
}
