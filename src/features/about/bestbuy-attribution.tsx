import { useState } from 'react'
import { cn } from '#/lib/utils'
import { AboutSheet } from './about-sheet'

/**
 * The Best Buy source mark. Their API Branding Guidelines require the logo
 * on every screen where API data appears, but a bare logo reads like
 * minimum-effort compliance. So the mark says its piece in words too:
 * where the data comes from AND that Best Buy didn't endorse this - the
 * good-faith version, not the get-past-the-terms version.
 *
 * The logo asset is the one Best Buy provides, unaltered (no recolor, no
 * crop, no proportion change; resizing is the single thing the terms
 * allow), smaller than our own branding per their layout rules. Tapping
 * opens the About sheet for the full story.
 */
export function BestBuyAttribution({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Data sourced from Best Buy, not endorsed by Best Buy. About this app"
        className={cn(
          'flex min-h-11 shrink-0 items-center gap-1.5 text-left transition-transform duration-100 active:scale-[0.97]',
          className,
        )}
      >
        <img
          src="/bestbuy-logo.png"
          alt="Best Buy"
          loading="lazy"
          className="h-5 w-auto"
        />
        <span className="flex flex-col gap-px leading-none">
          <span className="text-micro font-bold text-text-muted">
            Data from Best Buy
          </span>
          <span className="text-micro text-text-faint">not endorsed</span>
        </span>
      </button>

      <AboutSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
