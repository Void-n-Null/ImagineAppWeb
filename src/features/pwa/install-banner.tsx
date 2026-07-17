/**
 * Install banner (IMA-12) — the part of PWA work nobody ships.
 *
 * Three variants, resolved from the environment:
 *  - Chromium: real Install button via the captured beforeinstallprompt.
 *  - iOS browsers: manual walkthrough (Share → Add to Home Screen). Since
 *    iOS 16.4 this works from Chrome/Edge/Firefox on iOS too, so the hint is
 *    NOT gated to Safari.
 *  - In-app webviews (Signal/Gmail/Instagram…): those have no share sheet
 *    and no install prompt — tell people to escape to a real browser first.
 *
 * Shown early and everywhere (all tab routes) on purpose: iOS standalone
 * gets its OWN IndexedDB, so chat threads built in the Safari tab do not
 * carry over into the installed app. The sooner someone installs, the less
 * history they "lose".
 *
 * Install-hint dismissal persists (localStorage) — it's an invitation, not
 * nagware. The in-app-browser warning only dismisses for the session: it is
 * blocking onboarding, and the user will be in a different browser next time
 * anyway.
 */

import { Share, SquarePlus, X } from 'lucide-react'
import { useState } from 'react'
import {
  type InstallSurface,
  isInAppBrowser,
  isIOS,
  isStandalone,
  resolveInstallSurface,
} from './detect'
import { useInstallPrompt } from './use-install-prompt'

export const INSTALL_HINT_DISMISSED = 'imagine:install-hint-dismissed'
const IN_APP_NOTICE_DISMISSED = 'imagine:in-app-notice-dismissed'

function readFlag(storage: () => Storage, key: string): boolean {
  try {
    return storage().getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(storage: () => Storage, key: string): void {
  try {
    storage().setItem(key, '1')
  } catch {
    // Private-mode storage failures just mean the banner returns next visit.
  }
}

export function InstallBanner() {
  const { canPrompt, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(() =>
    typeof window === 'undefined'
      ? true
      : readFlag(() => localStorage, INSTALL_HINT_DISMISSED) ||
        readFlag(() => sessionStorage, IN_APP_NOTICE_DISMISSED),
  )
  const [installed, setInstalled] = useState(false)

  if (typeof window === 'undefined' || dismissed || installed) return null

  const surface: InstallSurface = resolveInstallSurface({
    standalone: isStandalone(),
    inAppBrowser: isInAppBrowser(),
    ios: isIOS(),
    hasNativePrompt: canPrompt,
  })
  if (surface === 'installed' || surface === 'none') return null

  const dismiss = () => {
    writeFlag(
      surface === 'in-app-browser' ? () => sessionStorage : () => localStorage,
      surface === 'in-app-browser'
        ? IN_APP_NOTICE_DISMISSED
        : INSTALL_HINT_DISMISSED,
    )
    setDismissed(true)
  }

  return (
    <section
      aria-label="Install the app"
      className="card-glint relative mx-5 mt-4 rounded-xl bg-surface p-4"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install hint"
        className="absolute top-2 right-2 grid h-9 w-9 place-items-center rounded-full text-text-faint active:bg-raised"
      >
        <X size={16} aria-hidden="true" />
      </button>

      {surface === 'in-app-browser' && (
        <div className="pr-8">
          <h2 className="text-body font-bold">Open in your browser</h2>
          <p className="mt-1 text-body-sm leading-relaxed text-text-muted">
            This in-app browser can't install Imagine. Tap the menu and choose
            "Open in Safari" or "Open in Chrome" first.
          </p>
        </div>
      )}

      {surface === 'ios-manual' && (
        <div className="pr-8">
          <h2 className="text-body font-bold">Add Imagine to your phone</h2>
          <p className="mt-1 text-body-sm leading-relaxed text-text-muted">
            Tap Share{' '}
            <Share
              size={14}
              aria-label="the Share icon"
              className="inline -translate-y-px text-action"
            />{' '}
            then{' '}
            <span className="font-semibold text-text">
              Add to Home Screen{' '}
              <SquarePlus
                size={14}
                aria-hidden="true"
                className="inline -translate-y-px text-action"
              />
            </span>{' '}
            — it works like a regular app, no App Store needed.
          </p>
        </div>
      )}

      {surface === 'native-prompt' && (
        <div className="flex flex-col gap-3 pr-8">
          <div>
            <h2 className="text-body font-bold">Install Imagine</h2>
            <p className="mt-1 text-body-sm leading-relaxed text-text-muted">
              Full screen, on your home screen, no app store.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void promptInstall().then((accepted) => {
                if (accepted) setInstalled(true)
              })
            }}
            className="min-h-11 rounded-lg bg-action px-4 text-body font-bold text-action-ink transition-transform duration-100 active:scale-[0.98]"
          >
            Install app
          </button>
        </div>
      )}
    </section>
  )
}
