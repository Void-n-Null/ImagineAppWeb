/**
 * Section jump rail (IMA-29): one horizontal row of chips that scrolls the
 * page to a section. The anti-"scroll forever hunting" affordance from
 * DOC-13 — mid-conversation, "In the box" or "Barcode" is one tap, not a
 * swipe-guess down an unknown page length.
 *
 * Chips render only for sections that exist on THIS product; a chip that
 * scrolls to nothing is a lie.
 */

export interface JumpTarget {
  id: string
  label: string
}

export function JumpRail({ targets }: { targets: JumpTarget[] }) {
  if (targets.length < 2) return null

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'start',
    })
  }

  return (
    <nav
      aria-label="Page sections"
      className="scrollbar-none -mx-5 flex gap-1.5 overflow-x-auto px-5"
    >
      {targets.map((target) => (
        <button
          key={target.id}
          type="button"
          onClick={() => jump(target.id)}
          className="min-h-9 shrink-0 rounded-full bg-raised px-3.5 text-caption font-bold text-text-muted transition-transform duration-100 active:scale-[0.97]"
        >
          {target.label}
        </button>
      ))}
    </nav>
  )
}
