import { useNavigate } from '@tanstack/react-router'
import { Loader2, Search } from 'lucide-react'
import { useRef, useState } from 'react'
import { lookupScannedProduct } from '#/server/functions/lookup-scanned-product'

/**
 * The homepage ask bar — v1's smart input, rebuilt (flutter home_page.dart
 * `_handleSearch`). One field, three destinations:
 *
 * - 4–10 digits  → it's a SKU: straight to /product/$sku (the detail page
 *   owns its own not-found state, so this costs zero extra calls).
 * - 11–14 digits → it's a UPC: resolve via lookupScannedProduct (the scan
 *   pipeline's classifier), then /product. Misses surface inline.
 * - anything else → /search, same as the plain ProductSearchBar.
 *
 * Employees type what's in front of them — a shelf-tag SKU, a box UPC, a
 * product name off a customer's screenshot — and the bar sorts it out.
 * Uses text-body-lg (16px) so iOS Safari doesn't zoom on focus.
 */
export function AskBar() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [miss, setMiss] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    const q = value.trim()
    if (q.length === 0 || busy) return
    setMiss(null)

    // Pure digit runs are codes, not queries.
    const digits = /^\d{4,14}$/.test(q)
    if (digits && q.length <= 10) {
      inputRef.current?.blur()
      void navigate({ to: '/product/$sku', params: { sku: q } })
      return
    }
    if (digits) {
      // UPC-length: resolve to a SKU first — /product/$sku can't take a UPC.
      setBusy(true)
      try {
        const result = await lookupScannedProduct({
          data: { rawValue: q, format: 'manual' },
        })
        if (result.status === 'found') {
          inputRef.current?.blur()
          void navigate({
            to: '/product/$sku',
            params: { sku: String(result.product.sku) },
          })
          return
        }
        setMiss(
          result.status === 'error'
            ? result.message
            : `No product for ${q} — try scanning the tag instead.`,
        )
      } catch {
        setMiss('Lookup failed — check connection.')
      } finally {
        setBusy(false)
      }
      return
    }

    inputRef.current?.blur()
    void navigate({ to: '/search', search: { q } })
  }

  return (
    <search>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="relative">
          {busy ? (
            <Loader2
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4.5 -translate-y-1/2 animate-spin text-action"
            />
          ) : (
            <Search
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4.5 -translate-y-1/2 text-text-faint"
            />
          )}
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              if (miss) setMiss(null)
            }}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            placeholder="Name, SKU, or UPC…"
            aria-label="Look up a product by name, SKU, or UPC"
            aria-busy={busy}
            className="min-h-14 w-full rounded-full border border-line-strong bg-raised pr-5 pl-12 text-body-lg text-text placeholder:text-text-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        {miss && (
          <p className="px-4 pt-2 text-caption font-semibold text-danger">
            {miss}
          </p>
        )}
      </form>
    </search>
  )
}
