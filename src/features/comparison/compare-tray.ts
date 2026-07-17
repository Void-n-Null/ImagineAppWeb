/**
 * Compare tray (IMA-29) — collect SKUs from detail pages into a pending
 * comparison, the way the research pattern names it: a "sticky compare bar
 * that collects SKUs from PDPs". Until now /compare was only reachable from
 * chat; the floor case is simpler: customer is torn between two boxes, the
 * employee opens each product page, taps Compare on both, taps the pill.
 *
 * Same reactive-storage idiom as cart-store.ts. Display snapshot (name)
 * rides along so the pill can label itself without a fetch. Capped at 5 —
 * the /compare table's own limit.
 */

import { useSyncExternalStore } from 'react'
import type { BestBuyProduct } from '#/server/bestbuy/types'

export const COMPARE_STORAGE = 'imagine:compare-tray'
export const COMPARE_EVENT = 'imagine:compare-tray-changed'
export const COMPARE_LIMIT = 5

export interface CompareEntry {
  sku: number
  name: string
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

const EMPTY: CompareEntry[] = []

let lastRaw: string | null = null
let lastParsed: CompareEntry[] = EMPTY

function parseEntries(raw: string | null): CompareEntry[] {
  if (raw === null) return EMPTY
  if (raw === lastRaw) return lastParsed
  try {
    const parsed = JSON.parse(raw) as unknown
    const entries = Array.isArray(parsed)
      ? parsed
          .filter(
            (entry): entry is CompareEntry =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as CompareEntry).sku === 'number' &&
              typeof (entry as CompareEntry).name === 'string',
          )
          .slice(0, COMPARE_LIMIT)
      : EMPTY
    lastRaw = raw
    lastParsed = entries
    return entries
  } catch {
    return EMPTY
  }
}

export function getCompareEntries(): CompareEntry[] {
  if (!isBrowser()) return EMPTY
  return parseEntries(localStorage.getItem(COMPARE_STORAGE))
}

function writeEntries(entries: CompareEntry[]): void {
  if (!isBrowser()) return
  localStorage.setItem(COMPARE_STORAGE, JSON.stringify(entries))
  window.dispatchEvent(new Event(COMPARE_EVENT))
}

/** Toggle membership. Returns the new membership state. */
export function toggleCompareEntry(product: BestBuyProduct): boolean {
  const entries = getCompareEntries()
  if (entries.some((entry) => entry.sku === product.sku)) {
    writeEntries(entries.filter((entry) => entry.sku !== product.sku))
    return false
  }
  // At capacity, drop the oldest — the employee is mid-conversation; a
  // refusal dialog would be worse than quietly rotating.
  const next = [...entries, { sku: product.sku, name: product.name }]
  writeEntries(next.slice(Math.max(0, next.length - COMPARE_LIMIT)))
  return true
}

/**
 * Add-only variant for scan collection (IMA-36): a re-scan of a box already
 * in the tray must NOT remove it the way toggle semantics would. Returns
 * true when newly added, false when it was already collected. Same
 * rotate-oldest-at-capacity behavior as toggle.
 */
export function addCompareEntry(product: BestBuyProduct): boolean {
  const entries = getCompareEntries()
  if (entries.some((entry) => entry.sku === product.sku)) return false
  const next = [...entries, { sku: product.sku, name: product.name }]
  writeEntries(next.slice(Math.max(0, next.length - COMPARE_LIMIT)))
  return true
}

/** Remove one entry by SKU (the chip's ✕ on the scan tray, IMA-36). */
export function removeCompareEntry(sku: number): void {
  writeEntries(getCompareEntries().filter((entry) => entry.sku !== sku))
}

export function clearCompareTray(): void {
  writeEntries([])
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === COMPARE_STORAGE) onChange()
  }
  window.addEventListener(COMPARE_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(COMPARE_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useCompareTray(): CompareEntry[] {
  return useSyncExternalStore(subscribe, getCompareEntries, () => EMPTY)
}
