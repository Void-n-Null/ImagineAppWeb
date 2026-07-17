import {
  createFileRoute,
  Link,
  useCanGoBack,
  useRouter,
} from '@tanstack/react-router'
import { ArrowLeft, Check } from 'lucide-react'
import type { ModelRecord } from '#/features/models'
import {
  formatMonth,
  formatPerMillion,
  formatTokens,
  hasVision,
  useModelCatalog,
  useSelectedModel,
  vendorName,
} from '#/features/models'
import { VendorLogo } from '#/features/models/components/vendor-logo'

/**
 * Model detail. A splat route because OpenRouter slugs contain "/"
 * (e.g. /models/anthropic/claude-sonnet-4.5).
 */
export const Route = createFileRoute('/_app/models/$')({
  component: ModelDetailPage,
})

function ModelDetailPage() {
  const { _splat: modelId = '' } = Route.useParams()
  const catalog = useModelCatalog()
  const { selectedId, select } = useSelectedModel()

  const model = catalog.data?.models.find((m) => m.id === modelId)

  return (
    <div className="flex flex-col gap-6 px-4 pt-4 pb-8">
      <BackToModels />

      {!catalog.data && catalog.isPending && (
        <output
          aria-label="Loading model"
          className="flex animate-pulse flex-col gap-4"
        >
          <div className="h-12 w-12 rounded-md bg-raised" />
          <div className="h-6 w-3/5 rounded bg-raised" />
          <div className="h-12 w-full rounded-md bg-raised" />
        </output>
      )}

      {catalog.data && !model && (
        <div className="flex flex-col items-start gap-2 py-8">
          <h1 className="text-heading font-bold">Model not found</h1>
          <p className="text-body-sm text-text-muted">
            <span className="font-mono">{modelId}</span> isn’t in the current
            catalog. It may have been renamed or removed.
          </p>
        </div>
      )}

      {model && (
        <ModelDetail
          model={model}
          selected={selectedId === model.id}
          onSelect={() => select(model.id)}
        />
      )}
    </div>
  )
}

function BackToModels() {
  const router = useRouter()
  const canGoBack = useCanGoBack()

  // Preserve the browse state (search/filter/sort) when we came from the list.
  if (canGoBack) {
    return (
      <button
        type="button"
        onClick={() => router.history.back()}
        className="-ml-2 flex min-h-11 w-fit items-center gap-1.5 rounded-md px-2 text-body-sm font-medium text-text-muted active:bg-raised"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Models
      </button>
    )
  }
  return (
    <Link
      to="/models"
      className="-ml-2 flex min-h-11 w-fit items-center gap-1.5 rounded-md px-2 text-body-sm font-medium text-text-muted active:bg-raised"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      Models
    </Link>
  )
}

function ModelDetail({
  model,
  selected,
  onSelect,
}: {
  model: ModelRecord
  selected: boolean
  onSelect: () => void
}) {
  return (
    <>
      <header className="flex items-start gap-3">
        <VendorLogo vendor={model.vendor} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title font-extrabold leading-tight tracking-tight">
              {model.name}
            </h1>
            {selected && <span className="price-tag">Yours</span>}
          </div>
          <p className="mt-1 text-body-sm text-text-muted">
            {vendorName(model.vendor)}
            <span className="text-text-faint"> · </span>
            <span className="break-all font-mono text-caption text-text-faint">
              {model.id}
            </span>
          </p>
        </div>
      </header>

      {selected ? (
        <p className="card-glint flex min-h-12 items-center justify-center gap-2 rounded-lg bg-surface text-body font-bold text-text-muted">
          <Check size={18} aria-hidden="true" className="text-ok" />
          Selected for chat
        </p>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="min-h-12 rounded-lg bg-action text-body font-bold text-action-ink transition-transform duration-100 active:scale-[0.98]"
        >
          Use this model
        </button>
      )}

      {model.description && (
        <p className="text-body leading-relaxed text-text-muted">
          {model.description}
        </p>
      )}

      <Section title="Pricing" panel>
        <Row label="Input" value={perMillion(model.cost.input)} />
        <Row label="Output" value={perMillion(model.cost.output)} />
        {model.cost.cacheRead !== undefined && (
          <Row label="Cache read" value={perMillion(model.cost.cacheRead)} />
        )}
        {model.cost.cacheWrite !== undefined && (
          <Row label="Cache write" value={perMillion(model.cost.cacheWrite)} />
        )}
      </Section>

      <Section title="Capabilities">
        <div className="flex flex-wrap gap-1.5 pb-2">
          <CapabilityPill on={model.reasoning} label="Reasoning" />
          <CapabilityPill on={model.toolCall} label="Tool calls" />
          <CapabilityPill on={hasVision(model)} label="Vision" />
          {model.structuredOutput !== null && (
            <CapabilityPill
              on={model.structuredOutput}
              label="Structured output"
            />
          )}
        </div>
        <Row label="Input" value={model.inputModalities.join(', ') || '—'} />
        <Row label="Output" value={model.outputModalities.join(', ') || '—'} />
      </Section>

      <Section title="Limits">
        <Row
          label="Context window"
          value={
            model.contextLength !== null
              ? `${formatTokens(model.contextLength)} tokens`
              : '—'
          }
        />
        <Row
          label="Max output"
          value={
            model.maxOutput !== null
              ? `${formatTokens(model.maxOutput)} tokens`
              : '—'
          }
        />
      </Section>

      {(model.releaseDate || model.knowledge || model.openWeights !== null) && (
        <Section title="About">
          {model.releaseDate && (
            <Row
              label="Released"
              value={formatMonth(model.releaseDate) ?? model.releaseDate}
            />
          )}
          {model.knowledge && (
            <Row
              label="Knowledge cutoff"
              value={formatMonth(model.knowledge) ?? model.knowledge}
            />
          )}
          {model.openWeights !== null && (
            <Row
              label="Open weights"
              value={model.openWeights ? 'Yes' : 'No'}
            />
          )}
        </Section>
      )}
    </>
  )
}

function perMillion(value: number | undefined): React.ReactNode {
  if (value === undefined) return '—'
  return (
    <>
      {formatPerMillion(value)}
      <span className="text-text-faint"> / 1M tokens</span>
    </>
  )
}

/**
 * Only Pricing gets a panel (it's the number the floor cares about); the
 * rest are flat definition lists with hairlines — not everything needs a box.
 */
function Section({
  title,
  children,
  panel = false,
}: {
  title: string
  children: React.ReactNode
  panel?: boolean
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="aisle-label">{title}</h2>
      <div
        className={
          panel
            ? 'card-glint flex flex-col gap-2.5 rounded-xl bg-surface p-4'
            : 'flex flex-col'
        }
      >
        {children}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-baseline justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
      <span className="text-body-sm text-text-muted">{label}</span>
      <span className="tabular text-right text-body-sm font-semibold">
        {value}
      </span>
    </div>
  )
}

function CapabilityPill({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-3 py-1.5 text-caption font-semibold ${
        on
          ? 'bg-action-subtle text-action'
          : 'bg-raised text-text-faint line-through decoration-1'
      }`}
    >
      {label}
    </span>
  )
}
