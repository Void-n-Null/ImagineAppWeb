/**
 * Scan mode (IMA-36) — what a successful scan DOES. Three modes, picked by
 * the segmented toggle on /scan:
 *
 *   detail  — navigate to the product page (the IMA-34 default)
 *   chat    — jump straight into the assistant with the product attached
 *   compare — stay on the camera; scans collect into the compare tray
 *
 * Same reactive-storage idiom as compare-tray.ts / selected-model.ts.
 * Deliberately device-local (no account settings sync): which mode the
 * scanner is in is a per-shift, in-the-hand habit — an associate mid
 * comparison-walk on their phone shouldn't have the mode yanked by a
 * preference they set on another device.
 */

import { useSyncExternalStore } from 'react'

export const SCAN_MODES = ['detail', 'chat', 'compare'] as const
export type ScanMode = (typeof SCAN_MODES)[number]

export const SCAN_MODE_STORAGE = 'imagine:scan-mode'
export const SCAN_MODE_EVENT = 'imagine:scan-mode-changed'

const DEFAULT_MODE: ScanMode = 'detail'

export const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  detail: 'Detail',
  chat: 'Chat',
  compare: 'Compare',
}

/**
 * The one-line caption under the toggle IS the onboarding — it swaps with the
 * mode so the first coworker to see the control needs no tutorial (IMA-36).
 */
export const SCAN_MODE_CAPTIONS: Record<ScanMode, string> = {
  detail: 'Scans open the product page',
  chat: 'Scans start a chat about the product',
  compare: 'Scan 2+ items to compare side by side',
}

function isScanMode(value: unknown): value is ScanMode {
  return (
    typeof value === 'string' &&
    (SCAN_MODES as readonly string[]).includes(value)
  )
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

export function getScanMode(): ScanMode {
  if (!isBrowser()) return DEFAULT_MODE
  const raw = localStorage.getItem(SCAN_MODE_STORAGE)
  return isScanMode(raw) ? raw : DEFAULT_MODE
}

export function setScanMode(mode: ScanMode): void {
  if (!isBrowser()) return
  localStorage.setItem(SCAN_MODE_STORAGE, mode)
  window.dispatchEvent(new Event(SCAN_MODE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SCAN_MODE_STORAGE) onChange()
  }
  window.addEventListener(SCAN_MODE_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(SCAN_MODE_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useScanMode(): ScanMode {
  return useSyncExternalStore(subscribe, getScanMode, () => DEFAULT_MODE)
}
