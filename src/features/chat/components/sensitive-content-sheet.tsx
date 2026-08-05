import { ShieldAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function SensitiveContentSheet({
  open,
  reason,
  onClose,
}: {
  open: boolean
  reason: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    const siblings = [...document.body.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== dialogRef.current,
    )
    const previousInert = siblings.map((element) => element.inert)
    for (const element of siblings) element.inert = true
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      siblings.forEach((element, index) => {
        element.inert = previousInert[index] ?? false
      })
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sensitive-content-title"
      aria-describedby="sensitive-content-description"
    >
      <button
        type="button"
        aria-label="Close message warning"
        onClick={onClose}
        className="animate-in fade-in absolute inset-0 cursor-default bg-black/50 duration-200"
        tabIndex={-1}
      />

      <section className="scrollbar-none animate-in slide-in-from-bottom absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line bg-surface px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] duration-300">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-raised text-amber-300">
            <ShieldAlert size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="sensitive-content-title"
              className="text-heading font-extrabold tracking-tight"
            >
              Message not sent
            </h2>
            <p
              id="sensitive-content-description"
              className="mt-1 text-body-sm leading-relaxed text-text-muted"
            >
              Imagine App stopped this message before saving or sending it. Your
              draft is still in the composer.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-raised px-4 py-3">
          <p className="aisle-label">What to remove</p>
          <p className="mt-1 text-body-sm leading-relaxed text-text-muted">
            {reason}
          </p>
        </div>

        <p className="mt-3 text-caption leading-relaxed text-text-faint">
          Use public product details only. Remove personal information,
          credentials, and nonpublic company details before trying again.
        </p>

        <div className="mt-5">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-xl bg-action px-4 text-body-sm font-bold text-action-ink transition-transform duration-100 active:scale-[0.98]"
          >
            Back to draft
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
