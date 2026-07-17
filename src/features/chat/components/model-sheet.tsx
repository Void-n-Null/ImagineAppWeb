import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import {
  cleanModelName,
  formatPerMillion,
  type ModelRecord,
  RECOMMENDED_PICKS,
  type RecommendedPick,
  useModelCatalog,
  useSelectedModel,
} from '#/features/models'
import { VendorLogo } from '#/features/models/components/vendor-logo'
import { cn } from '#/lib/utils'

/**
 * In-chat model switcher (IMA-9, reorganized around the three-tier lineup in
 * IMA-43): a bottom sheet with the benchmarked tiers — default, step-up,
 * best — each carrying its measured floor-bench score, answer speed, and
 * credit burn, so switching brains is a priced decision, not a vibe. The
 * full catalog stays one tap away in /models; an off-lineup selection still
 * shows at the top so nobody's current model vanishes.
 *
 * Switching mid-conversation is safe by construction — the model id is
 * read fresh on every send.
 */
export function ModelSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const catalog = useModelCatalog()
  const { selectedId, select } = useSelectedModel()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const { tiers, offLineup } = useMemo(() => {
    const models = catalog.data?.models
    if (!models) {
      return {
        tiers: [] as Array<{ model: ModelRecord; pick: RecommendedPick }>,
        offLineup: undefined as ModelRecord | undefined,
      }
    }
    const tiers = RECOMMENDED_PICKS.flatMap((pick) => {
      const model = models.find((m) => m.id === pick.id)
      return model ? [{ model, pick }] : []
    })
    // The current model always appears, even when it's an off-lineup pick.
    const offLineup = tiers.some((t) => t.model.id === selectedId)
      ? undefined
      : models.find((m) => m.id === selectedId)
    return { tiers, offLineup }
  }, [catalog.data, selectedId])

  if (!open) return null

  const pickAndClose = (id: string) => {
    select(id)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a model"
    >
      <button
        type="button"
        aria-label="Close model picker"
        onClick={onClose}
        className="animate-in fade-in absolute inset-0 cursor-default bg-black/50 duration-200"
        tabIndex={-1}
      />

      <div className="animate-in slide-in-from-bottom absolute inset-x-0 bottom-0 mx-auto flex max-h-[75dvh] w-full max-w-lg flex-col rounded-t-2xl border-t border-line bg-surface duration-300">
        <header className="flex items-end justify-between gap-3 px-5 pt-5 pb-2">
          <div>
            <p className="aisle-label">Model</p>
            <h2 className="mt-0.5 text-heading font-extrabold tracking-tight">
              Three tiers, benchmarked
            </h2>
          </div>
          <Link
            to="/models"
            onClick={onClose}
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-action-subtle px-3.5 text-caption font-bold text-action transition-transform duration-100 active:scale-[0.97]"
          >
            Browse all
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </header>

        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {tiers.length === 0 ? (
            <p className="px-3 py-8 text-center text-body-sm text-text-muted">
              {catalog.isPending
                ? 'Loading models…'
                : 'Couldn’t load the catalog — pick in Models instead.'}
            </p>
          ) : (
            <>
              {offLineup && (
                <ul className="m-0 list-none border-b border-line p-0 pb-1.5 mb-1.5">
                  <OffLineupOption
                    model={offLineup}
                    selected
                    onPick={() => pickAndClose(offLineup.id)}
                  />
                </ul>
              )}
              <ul className="m-0 list-none p-0">
                {tiers.map(({ model, pick }, i) => (
                  <TierOption
                    key={model.id}
                    model={model}
                    pick={pick}
                    tier={i + 1}
                    selected={model.id === selectedId}
                    onPick={() => pickAndClose(model.id)}
                  />
                ))}
              </ul>
              <p className="px-3 pt-2 text-micro leading-relaxed text-text-faint">
                Measured on our 53-question floor benchmark. Credit burn is per
                question, relative to the default.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** One benchmarked tier: identity, tagline, measured stats, credit burn. */
function TierOption({
  model,
  pick,
  tier,
  selected,
  onPick,
}: {
  model: ModelRecord
  pick: RecommendedPick
  tier: number
  selected: boolean
  onPick: () => void
}) {
  const { stats } = pick
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-100 active:bg-raised',
          selected && 'bg-action-subtle',
        )}
      >
        <span
          aria-hidden="true"
          className="w-5 shrink-0 font-mono text-caption font-bold text-text-faint/60"
        >
          {String(tier).padStart(2, '0')}
        </span>
        <VendorLogo vendor={model.vendor} size={32} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'truncate text-body font-semibold',
                selected && 'text-action',
              )}
            >
              {cleanModelName(model.name)}
            </span>
            <span className="shrink-0 rounded-full bg-action-subtle px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-action">
              {pick.tagline}
            </span>
            {selected && <span className="price-tag shrink-0">Yours</span>}
          </span>
          <span className="tabular mt-1 block truncate text-caption text-text-muted">
            <b className="font-semibold text-text">{stats.benchPercent}%</b>{' '}
            bench
            <span className="text-text-faint"> · </span>
            {stats.medianSeconds}s<span className="text-text-faint"> · </span>~
            {stats.questionsPerGrant} questions / $0.50
          </span>
        </span>

        <span
          className={cn(
            'tabular shrink-0 text-body-sm font-bold',
            stats.burnX === 1 ? 'text-ok' : 'text-text-muted',
          )}
        >
          {stats.burnX}x
          <span className="block text-right text-micro font-medium text-text-faint">
            credits
          </span>
        </span>
      </button>
    </li>
  )
}

/**
 * The user's current model when it isn't one of the three tiers (picked from
 * the full catalog). No bench stats to show — fall back to raw pricing.
 */
function OffLineupOption({
  model,
  selected,
  onPick,
}: {
  model: ModelRecord
  selected: boolean
  onPick: () => void
}) {
  const { input, output } = model.cost
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-100 active:bg-raised',
          selected && 'bg-action-subtle',
        )}
      >
        <span aria-hidden="true" className="w-5 shrink-0" />
        <VendorLogo vendor={model.vendor} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'truncate text-body font-semibold',
                selected && 'text-action',
              )}
            >
              {cleanModelName(model.name)}
            </span>
            {selected && <span className="price-tag shrink-0">Yours</span>}
          </span>
          <span className="mt-0.5 block truncate text-caption text-text-faint">
            Your pick — outside the benchmarked lineup
          </span>
        </span>
        <span className="tabular shrink-0 text-body-sm text-text-muted">
          {input !== undefined && output !== undefined ? (
            <>
              {formatPerMillion(input)}
              <span className="text-text-faint"> / </span>
              {formatPerMillion(output)}
            </>
          ) : (
            <span className="text-text-faint">—</span>
          )}
        </span>
      </button>
    </li>
  )
}
