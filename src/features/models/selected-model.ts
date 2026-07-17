// Which model the user has chosen for chat. Reactive-storage pattern:
// localStorage + a same-tab event + the native cross-tab `storage` event,
// consumed through useSyncExternalStore (mirrored by chat-settings.ts).

import { useCallback, useSyncExternalStore } from 'react'
import { capture } from '#/features/analytics/analytics'
import { pushSettingUp } from '#/features/settings/settings-sync'

export const SELECTED_MODEL_STORAGE = 'imagine:selected-model'
export const SELECTED_MODEL_EVENT = 'imagine:selected-model-changed'

/**
 * Sensible default until the user picks: the pool-economics default per
 * IMA-DOC-16 — the measured-cheap tool-loop model that keeps pool-key turns
 * affordable (allowlist: src/features/agent/model-allowlist.ts).
 */
export const DEFAULT_MODEL_ID = 'google/gemini-3.1-flash-lite'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

export function getSelectedModelId(): string {
  if (!isBrowser()) return DEFAULT_MODEL_ID
  return localStorage.getItem(SELECTED_MODEL_STORAGE) ?? DEFAULT_MODEL_ID
}

/**
 * Apply a value to localStorage + notify subscribers WITHOUT syncing up. The
 * restore path (settings-sync) uses this so writing the server's value back
 * into localStorage doesn't bounce it straight back to the server (IMA-31).
 */
export function applySelectedModelIdLocal(id: string): void {
  if (!isBrowser()) return
  localStorage.setItem(SELECTED_MODEL_STORAGE, id)
  window.dispatchEvent(new Event(SELECTED_MODEL_EVENT))
}

export function setSelectedModelId(id: string): void {
  applySelectedModelIdLocal(id)
  // Mirror UP to the account (IMA-31): localStorage stays the synchronous
  // in-session source; this fire-and-forget patch makes it follow the account.
  pushSettingUp({ selectedModel: id })
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SELECTED_MODEL_STORAGE) onChange()
  }
  window.addEventListener(SELECTED_MODEL_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(SELECTED_MODEL_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useSelectedModel(): {
  selectedId: string
  select: (id: string) => void
} {
  const selectedId = useSyncExternalStore(
    subscribe,
    getSelectedModelId,
    () => DEFAULT_MODEL_ID,
  )
  const select = useCallback((id: string) => {
    setSelectedModelId(id)
    capture('model_selected', { model_id: id })
  }, [])
  return { selectedId, select }
}
