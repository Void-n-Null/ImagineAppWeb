import { Link } from '@tanstack/react-router'
import { Scale, X } from 'lucide-react'
import { removeCompareEntry, useCompareTray } from './compare-tray'

/**
 * Inline collected-scans tray for Compare mode on /scan (IMA-36). Unlike the
 * floating ComparePill (which portals over detail pages), this sits in the
 * page flow under the camera: chips for what's been zapped so far, and a
 * "Start compare" button once two items make it an actual comparison.
 * Shares the compare-tray store with the detail pages' Compare buttons, so
 * a walk can mix scans and taps.
 */
export function CompareStrip() {
  const entries = useCompareTray()
  if (entries.length === 0) return null

  return (
    <section
      aria-label="Collected for comparison"
      className="flex flex-col gap-2"
    >
      <h2 className="aisle-label">Comparing ({entries.length})</h2>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {entries.map((entry) => (
          <li
            key={entry.sku}
            className="rise-in flex max-w-full items-center gap-0.5 rounded-full bg-raised py-0.5 pl-3 text-caption font-semibold"
          >
            <span className="max-w-48 truncate">{entry.name}</span>
            <button
              type="button"
              aria-label={`Remove ${entry.name} from comparison`}
              onClick={() => removeCompareEntry(entry.sku)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-faint active:bg-surface"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {entries.length >= 2 ? (
        <Link
          to="/compare"
          search={{ skus: entries.map((entry) => entry.sku).join(',') }}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-action text-body font-bold text-action-ink transition-transform duration-100 active:scale-[0.98]"
        >
          <Scale size={16} aria-hidden="true" />
          Start compare ({entries.length})
        </Link>
      ) : (
        <p className="text-caption text-text-faint">
          Scan one more item to compare.
        </p>
      )}
    </section>
  )
}
