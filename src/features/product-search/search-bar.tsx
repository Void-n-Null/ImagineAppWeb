import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { capture } from '#/features/analytics/analytics'

/**
 * Product search bar — the keyboard path to the catalog (the camera path is
 * the scanner). Submitting navigates to /search; the query executes there so
 * the bar itself never spends a Best Buy call. Uses text-body-lg (16px) so
 * iOS Safari doesn't zoom the viewport on focus.
 */
export function ProductSearchBar({
  initialQuery = '',
  autoFocus = false,
  onSearch,
}: {
  initialQuery?: string
  autoFocus?: boolean
  /** Keeps the search local when a picker needs results inline. */
  onSearch?: (query: string) => void
}) {
  const navigate = useNavigate()
  const [value, setValue] = useState(initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  // Back/forward between searches updates the URL param — follow it.
  useEffect(() => setValue(initialQuery), [initialQuery])

  return (
    <search>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const q = value.trim()
          if (q.length === 0) return
          capture('search_executed', {
            query_length: q.length,
            source: 'search_bar',
            query: q,
          })
          inputRef.current?.blur()
          if (onSearch) onSearch(q)
          else void navigate({ to: '/search', search: { q } })
        }}
      >
        <div className="relative">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-faint"
          />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            // biome-ignore lint/a11y/noAutofocus: opt-in, only on the empty /search page
            autoFocus={autoFocus}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            placeholder="Search products — “65 tv”, “usb-c hub”…"
            aria-label="Search Best Buy products"
            className="min-h-13 w-full rounded-xl border border-line-strong bg-raised pr-4 pl-11 text-body-lg text-text placeholder:text-text-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      </form>
    </search>
  )
}
