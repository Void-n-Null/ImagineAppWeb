/**
 * Capture Chromium's `beforeinstallprompt` so we can offer a real one-tap
 * Install button instead of hoping users find the browser menu (IMA-12).
 * The event fires once, early — we stash it in module scope so a banner
 * mounted later (or remounted) still has it.
 */

import { useEffect, useState } from 'react'
import { recordInstallPromptAccepted } from './register-sw'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault() // suppress Chrome's mini-infobar; we own the UX
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export function useInstallPrompt(): {
  canPrompt: boolean
  promptInstall: () => Promise<boolean>
} {
  const [canPrompt, setCanPrompt] = useState(deferredPrompt !== null)

  useEffect(() => {
    const update = () => setCanPrompt(deferredPrompt !== null)
    listeners.add(update)
    update()
    return () => {
      listeners.delete(update)
    }
  }, [])

  return {
    canPrompt,
    promptInstall: async () => {
      const prompt = deferredPrompt
      if (!prompt) return false
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') recordInstallPromptAccepted()
      deferredPrompt = null
      notify()
      return outcome === 'accepted'
    },
  }
}
