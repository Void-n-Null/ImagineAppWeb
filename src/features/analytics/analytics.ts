import posthog, { type PostHogConfig } from 'posthog-js'

export type EventName =
  | 'search_executed'
  | 'product_opened'
  | 'chat_message_sent'
  | 'openrouter_connected'
  | 'scan_used'
  | 'compare_used'
  | 'cart_added'
  | 'search_results_loaded'
  | 'chat_turn_completed'
  | 'model_selected'
  | 'pwa_installed'

export const posthogApiKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY

export const posthogOptions = {
  api_host: import.meta.env.DEV ? 'https://us.i.posthog.com' : '/ph',
  ui_host: 'https://us.posthog.com',
  defaults: '2026-05-30',
  capture_exceptions: true,
} satisfies Partial<PostHogConfig>

let warnedDisabled = false

export { posthog }

export function warnIfAnalyticsDisabled(): void {
  if (typeof window === 'undefined' || posthogApiKey || warnedDisabled) return
  console.warn('PostHog key not set, analytics disabled')
  warnedDisabled = true
}

export function capture(
  event: EventName,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === 'undefined' || !posthogApiKey) return
  posthog.capture(event, properties)
}
