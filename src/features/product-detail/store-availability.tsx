import { useQuery } from '@tanstack/react-query'
import { MapPin, Store } from 'lucide-react'
import { useState } from 'react'
import { checkStoreAvailability } from '#/server/functions/check-store-availability'

/**
 * Per-store pickup availability (IMA-10) — the REAL stock check (Stores
 * API), unlike the chain-wide "Sold in stores" flag (IMA-24 doctrine).
 *
 * ZIP-entry driven; the last ZIP persists so the on-shift flow is one tap
 * after the first use. Data is intraday truth — short server TTL, never
 * grace-served stale.
 */

const ZIP_STORAGE = 'imagine:availability-zip'

function storedZip(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(ZIP_STORAGE) ?? ''
}

export function StoreAvailabilitySection({ sku }: { sku: number }) {
  const [zipInput, setZipInput] = useState(storedZip)
  const [zip, setZip] = useState(storedZip)
  const zipValid = /^\d{5}$/.test(zip)

  const availability = useQuery({
    queryKey: ['store-availability', sku, zip],
    enabled: zipValid,
    queryFn: () => checkStoreAvailability({ data: { sku, postalCode: zip } }),
    // Intraday data: don't let a stale page linger past a shift break.
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const submit = () => {
    const trimmed = zipInput.trim()
    if (!/^\d{5}$/.test(trimmed)) return
    localStorage.setItem(ZIP_STORAGE, trimmed)
    setZip(trimmed)
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="aisle-label">Nearby stores</h2>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          placeholder="ZIP code"
          aria-label="ZIP code"
          value={zipInput}
          onChange={(e) => setZipInput(e.target.value.replace(/\D/g, ''))}
          className="card-glint h-11 w-32 rounded-xl bg-raised px-3.5 text-body-lg text-text placeholder:text-text-faint"
        />
        <button
          type="submit"
          disabled={!/^\d{5}$/.test(zipInput.trim())}
          className="min-h-11 rounded-xl bg-action px-4 text-body-sm font-bold text-action-ink transition-transform duration-100 active:scale-[0.98] disabled:opacity-40"
        >
          Check
        </button>
      </form>

      {!zipValid ? (
        <p className="text-caption text-text-faint">
          Live pickup stock by store — enter a ZIP to check.
        </p>
      ) : availability.isPending ? (
        <output
          aria-label="Checking stores"
          className="status-shimmer text-body-sm font-semibold"
        >
          Checking stores near {zip}…
        </output>
      ) : availability.data?.status === 'ok' ? (
        availability.data.page.stores.length === 0 ? (
          <p className="text-body-sm text-text-muted">
            No stores near {zip} have it for pickup right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {availability.data.page.stores.slice(0, 6).map((store) => (
              <li
                key={store.storeId}
                className="card-glint flex items-center gap-3 rounded-xl bg-surface px-3.5 py-2.5"
              >
                <Store
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-ok"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-semibold">
                    {store.name ?? `Store ${store.storeId}`}
                  </p>
                  <p className="truncate text-caption text-text-faint">
                    {[store.city, store.state].filter(Boolean).join(', ')}
                    {store.distance !== null &&
                      ` · ${store.distance.toFixed(1)} mi`}
                  </p>
                </div>
                {store.lowStock && (
                  <span className="shrink-0 rounded-full bg-danger-subtle px-2.5 py-1 text-micro font-bold text-danger">
                    Low stock
                  </span>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-body-sm text-danger">
          {availability.data?.status === 'error'
            ? availability.data.message
            : 'Store check failed — try again.'}
        </p>
      )}

      {zipValid && availability.data?.status === 'ok' && (
        <p className="flex items-center gap-1 text-micro text-text-faint">
          <MapPin size={11} aria-hidden="true" />
          Pickup availability right now — changes during the day.
        </p>
      )}
    </section>
  )
}
