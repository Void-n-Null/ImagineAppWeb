/**
 * One-time "welcome" flag for the first signed-in, granted empty state
 * (IMA-16 #368). We show the "100 credits on the house" variant exactly once
 * per device, then set this so every empty chat afterward is the normal
 * suggestions state. localStorage (not the account) on purpose: it's a
 * device-local first-run nicety, not settings worth syncing.
 */

const WELCOME_SEEN = 'imagine:welcome-seen'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

/** True until {@link markWelcomeSeen} has been called on this device. */
export function shouldShowWelcome(): boolean {
  if (!isBrowser()) return false
  try {
    return localStorage.getItem(WELCOME_SEEN) !== '1'
  } catch {
    return false
  }
}

/** Record that the welcome variant has been shown; it won't return. */
export function markWelcomeSeen(): void {
  if (!isBrowser()) return
  try {
    localStorage.setItem(WELCOME_SEEN, '1')
  } catch {
    // Private-mode storage — the welcome may show again; harmless.
  }
}
