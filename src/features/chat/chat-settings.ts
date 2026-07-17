// Chat presentation settings. Default UX hides the agent's tool traffic
// behind a single activity pill; flipping this on renders every tool call
// with args + results inline — the "debug mode" parity view.
// Same reactive-storage idiom as models/selected-model.ts.

import { useCallback, useSyncExternalStore } from 'react'
import { pushSettingUp } from '#/features/settings/settings-sync'

export const SHOW_TOOLS_STORAGE = 'imagine:chat-show-tools'
export const SHOW_TOOLS_EVENT = 'imagine:chat-show-tools-changed'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

export function getShowToolActivity(): boolean {
  if (!isBrowser()) return false
  return localStorage.getItem(SHOW_TOOLS_STORAGE) === 'true'
}

/**
 * Apply to localStorage + notify subscribers WITHOUT syncing up — used by the
 * settings restore path so the server's value doesn't echo back (IMA-31).
 */
export function applyShowToolActivityLocal(value: boolean): void {
  if (!isBrowser()) return
  localStorage.setItem(SHOW_TOOLS_STORAGE, String(value))
  window.dispatchEvent(new Event(SHOW_TOOLS_EVENT))
}

export function setShowToolActivity(value: boolean): void {
  applyShowToolActivityLocal(value)
  // Mirror UP to the account (IMA-31), fire-and-forget.
  pushSettingUp({ showToolActivity: value })
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHOW_TOOLS_STORAGE) onChange()
  }
  window.addEventListener(SHOW_TOOLS_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(SHOW_TOOLS_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useShowToolActivity(): {
  showTools: boolean
  setShowTools: (value: boolean) => void
} {
  const showTools = useSyncExternalStore(
    subscribe,
    getShowToolActivity,
    () => false,
  )
  const setShowTools = useCallback((value: boolean) => {
    setShowToolActivity(value)
  }, [])
  return { showTools, setShowTools }
}
