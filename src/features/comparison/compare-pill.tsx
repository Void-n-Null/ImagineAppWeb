import { Link } from '@tanstack/react-router'
import { Scale, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { clearCompareTray, useCompareTray } from './compare-tray'

/**
 * Floating "Compare (n)" pill (IMA-29). Appears once the tray holds 2+
 * SKUs — one item isn't a comparison yet, and a pill demanding attention
 * for an incomplete thought is noise. Portaled to <body>: detail-page
 * sections animate with transforms, which would capture fixed positioning
 * (same trap the POS sheet documents).
 */
export function ComparePill() {
  const entries = useCompareTray()
  if (entries.length < 2 || typeof document === 'undefined') return null

  return createPortal(
    <div className="rise-in fixed bottom-24 left-1/2 z-40 -translate-x-1/2">
      <div className="chrome-float flex items-center gap-0.5 rounded-full py-1 pr-1 pl-1.5">
        <Link
          to="/compare"
          search={{ skus: entries.map((entry) => entry.sku).join(',') }}
          className="flex min-h-9 items-center gap-2 rounded-full px-2.5 text-body-sm font-bold text-action"
        >
          <Scale size={15} aria-hidden="true" />
          Compare {entries.length}
        </Link>
        <button
          type="button"
          aria-label="Clear comparison"
          onClick={clearCompareTray}
          className="grid h-9 w-9 place-items-center rounded-full text-text-faint active:bg-action-subtle"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  )
}
