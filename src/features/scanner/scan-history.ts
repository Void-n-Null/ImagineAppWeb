/**
 * Scan history (IMA-34). The last handful of scanned barcodes, persisted so a
 * floor conversation that bounces between a few boxes keeps them one tap away
 * across reloads and back-navigations.
 *
 * Same reactive-storage idiom as cart-store.ts / recently-viewed.ts:
 * localStorage + a same-tab event + the native cross-tab `storage` event,
 * consumed through useSyncExternalStore.
 *
 * We persist ONLY the raw scan payload — {@link ScanHistoryEntry} — never the
 * resolved product. Each row re-resolves through React Query + the server-side
 * Upstash entity cache (with negative aliases for misses), so a stored scan
 * costs zero Best Buy requests to repaint.
 */

import { useSyncExternalStore } from 'react'

export const SCAN_HISTORY_STORAGE = 'imagine.scan-history.v1'
export const SCAN_HISTORY_EVENT = 'imagine:scan-history-changed'
export const SCAN_HISTORY_LIMIT = 20

/** The minimal record of a scan: the payload plus when it was seen. */
export interface ScanHistoryEntry {
  rawValue: string
  format: string
  at: number
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

const EMPTY: ScanHistoryEntry[] = []

// useSyncExternalStore needs referentially-stable snapshots; cache the parse
// keyed by the raw string so unrelated re-renders don't loop.
let lastRaw: string | null = null
let lastParsed: ScanHistoryEntry[] = EMPTY

function parseEntries(raw: string | null): ScanHistoryEntry[] {
  if (raw === null) return EMPTY
  if (raw === lastRaw) return lastParsed
  try {
    const parsed = JSON.parse(raw) as unknown
    const entries = Array.isArray(parsed)
      ? parsed.filter(
          (item): item is ScanHistoryEntry =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as ScanHistoryEntry).rawValue === 'string' &&
            typeof (item as ScanHistoryEntry).format === 'string' &&
            typeof (item as ScanHistoryEntry).at === 'number',
        )
      : EMPTY
    lastRaw = raw
    lastParsed = entries
    return entries
  } catch {
    return EMPTY
  }
}

export function getScanHistory(): ScanHistoryEntry[] {
  if (!isBrowser()) return EMPTY
  return parseEntries(localStorage.getItem(SCAN_HISTORY_STORAGE))
}

function writeEntries(entries: ScanHistoryEntry[]): void {
  if (!isBrowser()) return
  localStorage.setItem(SCAN_HISTORY_STORAGE, JSON.stringify(entries))
  window.dispatchEvent(new Event(SCAN_HISTORY_EVENT))
}

/**
 * Record a scan: newest-first, capped at {@link SCAN_HISTORY_LIMIT}. Two
 * consecutive scans of the SAME payload collapse to one row (its timestamp
 * refreshed) — the scanner re-fires the same code as you hold the camera on
 * a box, and a wall of identical rows is noise. Distinct payloads seen later
 * (even if the same code was scanned earlier) get their own fresh row.
 */
export function recordScan(entry: ScanHistoryEntry): void {
  if (!isBrowser()) return
  const history = getScanHistory()
  const head = history[0]
  const rest =
    head && head.rawValue === entry.rawValue && head.format === entry.format
      ? history.slice(1)
      : history
  writeEntries([entry, ...rest].slice(0, SCAN_HISTORY_LIMIT))
}

/** Empty the scan history. Returns how many rows were cleared. */
export function clearScanHistory(): number {
  const count = getScanHistory().length
  if (count > 0) writeEntries([])
  return count
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SCAN_HISTORY_STORAGE) onChange()
  }
  window.addEventListener(SCAN_HISTORY_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(SCAN_HISTORY_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useScanHistory(): ScanHistoryEntry[] {
  return useSyncExternalStore(subscribe, getScanHistory, () => EMPTY)
}
