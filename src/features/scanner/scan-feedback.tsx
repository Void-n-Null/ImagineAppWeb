import { AlertTriangle, Check, PackageX, ScanLine } from 'lucide-react'
import type { ScanLookupResult } from '#/server/functions/lookup-scanned-product'

/**
 * Non-blocking failure feedback for the scanner (IMA-34). A found scan
 * navigates straight to the product page; every other outcome has to say
 * something WITHOUT leaving the camera — the employee is still holding it at
 * the shelf and wants to try the next tag. This is the pill that floats over
 * the bottom of the reticle and auto-dismisses.
 *
 * v1 parity: distinct copy per failure so "nothing happened" never reads as a
 * broken app. "Too short" vs "not a product code" tells the user whether to
 * re-aim (partial read) or give up on this symbol (a wifi QR, a URL, …).
 */
export interface ScanFeedback {
  /** 'ok' = a Compare-mode collect (IMA-36) — the one success that stays on camera. */
  tone: 'ok' | 'warn' | 'error'
  message: string
}

/**
 * Map a resolved lookup to feedback, or null when it's a `found` (the caller
 * navigates instead of showing a pill).
 */
export function feedbackForResult(
  result: ScanLookupResult,
): ScanFeedback | null {
  switch (result.status) {
    case 'found':
      return null
    case 'unrecognized':
      return result.reason === 'too_short'
        ? { tone: 'warn', message: 'Code too short' }
        : { tone: 'warn', message: 'Not a product code' }
    case 'not_found':
      return { tone: 'warn', message: 'Not in the Best Buy catalog' }
    case 'error':
      return {
        tone: 'error',
        message: result.rateLimited
          ? 'Rate limited — try again in a moment'
          : result.message,
      }
  }
}

/** Feedback for a thrown/transport-level query error (not a `status:'error'`). */
export const NETWORK_FEEDBACK: ScanFeedback = {
  tone: 'error',
  message: 'Lookup failed — check connection',
}

/**
 * The floating pill. Absolutely positioned by its parent over the camera view;
 * this component only owns its own look, not placement. Rendered only while a
 * feedback value is live (the page clears it on a timer).
 */
export function ScanFeedbackPill({ feedback }: { feedback: ScanFeedback }) {
  const Icon =
    feedback.tone === 'ok'
      ? Check
      : feedback.tone === 'error'
        ? AlertTriangle
        : feedback.message === 'Not in the Best Buy catalog'
          ? PackageX
          : ScanLine
  const iconColor =
    feedback.tone === 'ok'
      ? 'text-ok'
      : feedback.tone === 'error'
        ? 'text-danger'
        : 'text-amber-300'

  return (
    <output
      aria-live="polite"
      className="rise-in pointer-events-none flex items-center gap-2 rounded-full bg-black/75 px-4 py-2.5 text-body-sm font-bold text-white shadow-lg backdrop-blur"
    >
      <Icon size={16} aria-hidden="true" className={iconColor} />
      {feedback.message}
    </output>
  )
}
