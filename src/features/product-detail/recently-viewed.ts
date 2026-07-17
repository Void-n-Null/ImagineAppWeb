/**
 * Recently viewed products (IMA-29). A floor conversation bounces between
 * two or three SKUs ("show me the LG again") — this keeps the last handful
 * one tap away, and since every viewed SKU is already in the React Query +
 * Redis caches, returning costs zero network.
 *
 * Same reactive-storage idiom as cart-store.ts. Snapshot carries what the
 * rail card renders (name/image/price) so it paints without a fetch.
 */

import { useSyncExternalStore } from 'react'
import type { BestBuyProduct } from '#/server/bestbuy/types'

export const RECENT_STORAGE = 'imagine:recently-viewed'
export const RECENT_EVENT = 'imagine:recently-viewed-changed'
export const RECENT_LIMIT = 8

export interface RecentProduct {
  sku: number
  name: string
  image: string | null
  price: number | null
  viewedAt: number
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

const EMPTY: RecentProduct[] = []

let lastRaw: string | null = null
let lastParsed: RecentProduct[] = EMPTY

function parseItems(raw: string | null): RecentProduct[] {
  if (raw === null) return EMPTY
  if (raw === lastRaw) return lastParsed
  try {
    const parsed = JSON.parse(raw) as unknown
    const items = Array.isArray(parsed)
      ? parsed.filter(
          (item): item is RecentProduct =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as RecentProduct).sku === 'number' &&
            typeof (item as RecentProduct).name === 'string',
        )
      : EMPTY
    lastRaw = raw
    lastParsed = items
    return items
  } catch {
    return EMPTY
  }
}

export function getRecentProducts(): RecentProduct[] {
  if (!isBrowser()) return EMPTY
  return parseItems(localStorage.getItem(RECENT_STORAGE))
}

/** Record a view: most-recent-first, deduped by SKU, capped. */
export function recordProductView(product: BestBuyProduct): void {
  if (!isBrowser()) return
  const entry: RecentProduct = {
    sku: product.sku,
    name: product.name,
    image: product.thumbnailImage ?? product.image,
    price: product.salePrice ?? product.regularPrice,
    viewedAt: Date.now(),
  }
  const rest = getRecentProducts().filter((item) => item.sku !== product.sku)
  localStorage.setItem(
    RECENT_STORAGE,
    JSON.stringify([entry, ...rest].slice(0, RECENT_LIMIT)),
  )
  window.dispatchEvent(new Event(RECENT_EVENT))
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === RECENT_STORAGE) onChange()
  }
  window.addEventListener(RECENT_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(RECENT_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useRecentProducts(): RecentProduct[] {
  return useSyncExternalStore(subscribe, getRecentProducts, () => EMPTY)
}
