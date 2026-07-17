import { capture } from '#/features/analytics/analytics'

let installListenerRegistered = false
let installPromptAccepted = false

export function recordInstallPromptAccepted(): void {
  installPromptAccepted = true
}

function registerInstallAnalytics(): void {
  if (installListenerRegistered) return
  window.addEventListener('appinstalled', () => {
    capture(
      'pwa_installed',
      installPromptAccepted
        ? { install_prompt_outcome: 'accepted' }
        : undefined,
    )
    installPromptAccepted = false
  })
  installListenerRegistered = true
}

/**
 * Service-worker registration (IMA-12). Production only: in dev a stale
 * shell cache fights Vite's module graph and turns HMR into a haunted house.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return
  registerInstallAnalytics()
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failure degrades to a plain web app — not fatal.
    })
  })
}
