/**
 * Environment detection for the install flow (IMA-12).
 *
 * Pure functions over (userAgent, platform hints) so every branch is unit
 * testable. Three questions decide what install UX to show:
 *   1. Already installed (standalone)? → nothing.
 *   2. Trapped in an in-app webview (Signal/Gmail/Instagram…)? → "open in a
 *      real browser" — these have no share sheet / no install prompt, and
 *      getting this wrong strands coworkers at onboarding step one.
 *   3. iOS (no install API, manual Share → Add to Home Screen walkthrough)
 *      vs Chromium (beforeinstallprompt → real Install button)?
 */

export type InstallSurface =
  | 'installed' // running standalone — no UX needed
  | 'in-app-browser' // webview jail — tell them to escape first
  | 'ios-manual' // Share → Add to Home Screen walkthrough
  | 'native-prompt' // beforeinstallprompt captured — show Install button
  | 'none' // nothing sensible to offer (e.g. desktop Firefox)

/** iPadOS ≥13 masquerades as macOS; touch points give it away. */
export function isIOS(
  ua: string = navigator.userAgent,
  maxTouchPoints: number = navigator.maxTouchPoints,
): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return /Macintosh/i.test(ua) && maxTouchPoints > 1
}

/** display-mode media query, plus the legacy iOS-only navigator flag. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return (
    'standalone' in window.navigator &&
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

/**
 * In-app browser markers. Not exhaustive — new webviews appear constantly —
 * but covers the apps coworkers actually paste links into. Android WebViews
 * self-identify with the "; wv)" token regardless of host app.
 */
const IN_APP_MARKERS = [
  'FBAN', // Facebook iOS
  'FBAV', // Facebook app family
  'FB_IAB', // Facebook in-app browser (Android)
  'Instagram',
  'Snapchat',
  'MicroMessenger', // WeChat
  'Line/',
  'LinkedInApp',
  'GSA/', // Google app (iOS)
  'DuckDuckGo',
]

export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  if (IN_APP_MARKERS.some((marker) => ua.includes(marker))) return true
  // Android WebView: "wv" token in the parenthesized platform section.
  return /Android.*; wv\)/.test(ua)
}

export function resolveInstallSurface(input: {
  standalone: boolean
  inAppBrowser: boolean
  ios: boolean
  hasNativePrompt: boolean
}): InstallSurface {
  if (input.standalone) return 'installed'
  if (input.inAppBrowser) return 'in-app-browser'
  if (input.hasNativePrompt) return 'native-prompt'
  if (input.ios) return 'ios-manual'
  return 'none'
}
