import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CONTACT_EMAIL, CONTACT_MAILTO } from '#/lib/contact'

/**
 * The "why this exists" sheet. Two jobs, in order: say plainly that this is
 * not a Best Buy product and runs on public data only, then explain why one
 * person built it anyway. Same bottom-sheet idiom as ModelSheet.
 *
 * Copy rules: human, plain, a little warm. No corporate hedging, no forced
 * relatability, and zero em dashes.
 */
export function AboutSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  // Portaled to <body>: the trigger badge lives inside headers whose
  // backdrop-filter (chrome-float, the search bar's blur) turns them into
  // containing blocks for position:fixed — rendered in place, the sheet
  // would be trapped and clipped inside the header instead of covering
  // the viewport. Guarded by the `open` early-return, so document always
  // exists when this runs.
  return createPortal(
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-label="About Imagine App"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-in fade-in absolute inset-0 cursor-default bg-black/50 duration-200"
        tabIndex={-1}
      />

      <div className="animate-in slide-in-from-bottom absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border-t border-line bg-surface duration-300">
        <header className="px-5 pt-5 pb-1">
          <h2 className="text-heading font-extrabold tracking-tight">
            Imagine App - Not from Best Buy
          </h2>
        </header>

        <div className="scrollbar-none min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pt-3 pb-2 text-body leading-relaxed text-text-muted">
          <p>
            Best Buy didn't build it and didn't endorse it. It's an independent
            project made by one person, Blake Werlinger, and it speaks only for
            itself.
          </p>

          <p>
            Everything it shows you is public. The catalog, the prices, the
            availability: it all comes from the official{' '}
            <a
              href="https://developer.bestbuy.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-action underline decoration-action/45 underline-offset-2"
            >
              Best Buy Developer API
            </a>
            , the same feed Best Buy hands to anyone who signs up for a key. No
            internal systems, no special access, nothing you couldn't look up
            yourself.
          </p>

          <p>
            About the Best Buy logo you'll see near product data: it's a source
            label, and that's all it is. Best Buy's API terms ask every app
            using their feed to show it, so we do. It marks where the numbers
            come from; it doesn't mean Best Buy built, approved, or endorsed any
            of this.
          </p>

          <p>
            I built it because looking something up on the floor usually means
            leaving the customer, finding a terminal, or digging through a few
            tabs while they wait. That's a bad way to answer a good question.
            Scan the tag, get the answer, keep talking. That's all this is
            trying to do.
          </p>

          <p>
            There are no ads and nobody is selling your data. I made it because
            I wanted it to exist. If it saves you a trip to ChatGPT or the
            nearest POS once in a while, that's the whole point.
          </p>

          <p className="text-body-sm text-text-faint">
            Made by{' '}
            <span className="font-semibold text-text-muted">
              Blake Werlinger
            </span>
            .
          </p>

          <div className="rounded-xl bg-raised px-4 py-3 text-caption leading-relaxed text-text-faint">
            <p className="font-bold text-text-muted">Get in touch</p>
            <p className="mt-1.5">
              For questions, feedback, or business inquiries:{' '}
              <a
                href={CONTACT_MAILTO}
                className="font-semibold text-action underline decoration-action/45 underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>

          <div className="rounded-xl bg-raised px-4 py-3 text-caption leading-relaxed text-text-faint">
            <p className="font-bold text-text-muted">Sources</p>
            <ul className="mt-1.5 space-y-1">
              <li>
                Product data:{' '}
                <a
                  href="https://developer.bestbuy.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-action underline decoration-action/45 underline-offset-2"
                >
                  developer.bestbuy.com
                </a>{' '}
                (<span className="tabular">api.bestbuy.com/v1</span>)
              </li>
              <li>
                Terms:{' '}
                <a
                  href="https://developer.bestbuy.com/legal"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-action underline decoration-action/45 underline-offset-2"
                >
                  Best Buy API license
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 w-full rounded-full bg-action text-body font-bold text-action-ink transition-transform duration-100 active:scale-[0.99]"
          >
            Good to know
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
