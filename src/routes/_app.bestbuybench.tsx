import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, CircleSlash, FlaskConical } from 'lucide-react'
import {
  BENCH_META,
  type BenchEntry,
  type CellScore,
  pct,
  rankedEntries,
  unusableEntries,
} from '#/features/models/bench-results'
import { VendorLogo } from '#/features/models/components/vendor-logo'
import { vendorColor } from '#/features/models/vendor'
import { cn } from '#/lib/utils'

/**
 * Best Buy Bench (IMA-43): the public scoreboard for "which model actually
 * works inside Imagine App." Layout follows what makes benchmark pages
 * trustworthy (researched 2026-07-08): direct answer first (highlight cards),
 * a cost-vs-score map, per-model breakdowns by cell — never just an
 * aggregate — and the methodology + limitations visible on the page, not in
 * an appendix. Static snapshot by design; numbers change only with a dated
 * re-run (bench-results.ts).
 */
export const Route = createFileRoute('/_app/bestbuybench')({
  component: BenchPage,
})

function BenchPage() {
  const ranked = rankedEntries()
  const dead = unusableEntries()

  return (
    <div className="flex flex-col gap-8 pb-8">
      <Header />
      <Highlights ranked={ranked} />
      <ScatterMap ranked={ranked} />
      <Leaderboard ranked={ranked} />
      <Disqualified entries={dead} />
      <Methodology />
      <NextSteps />
    </div>
  )
}

/* ── Header ─────────────────────────────────────────────────────────────── */

function Header() {
  return (
    <header className="px-4 pt-6">
      <p className="aisle-label">The floor benchmark</p>
      <h1 className="mt-1 text-title font-extrabold tracking-tight">
        Best Buy Bench
      </h1>
      <p className="mt-1.5 max-w-md text-body-sm leading-relaxed text-text-muted">
        Which model actually works inside Imagine App — measured on real
        sales-floor questions with objectively checkable answers, through the
        app’s full tool stack. No judge model, no vibes.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <MetaChip>{BENCH_META.runDate}</MetaChip>
        <MetaChip>{BENCH_META.questionCount} questions</MetaChip>
        <MetaChip>live Best Buy catalog</MetaChip>
        <MetaChip>production agent stack</MetaChip>
      </div>
    </header>
  )
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="tabular rounded-full bg-raised px-2.5 py-1 text-micro font-semibold tracking-wide text-text-muted">
      {children}
    </span>
  )
}

/* ── Highlights: the direct answer, before any table ────────────────────── */

function Highlights({ ranked }: { ranked: BenchEntry[] }) {
  const byId = (id: string) => ranked.find((e) => e.id === id)
  const cards = [
    { label: 'Top score', entry: byId('anthropic/claude-sonnet-5') },
    { label: 'Best value', entry: byId('google/gemini-3.1-flash-lite') },
    { label: 'Sweet spot', entry: byId('google/gemini-3-flash-preview') },
  ].filter((c): c is { label: string; entry: BenchEntry } => Boolean(c.entry))

  return (
    <section className="flex flex-col gap-2 px-4" aria-label="Headline results">
      <div className="grid grid-cols-3 gap-2">
        {cards.map(({ label, entry }) => (
          <div
            key={entry.id}
            className="card-glint flex flex-col gap-1.5 rounded-xl bg-surface p-3"
          >
            <span className="text-micro font-bold uppercase tracking-wider text-action">
              {label}
            </span>
            <VendorLogo vendor={entry.vendor} size={24} />
            <span className="text-caption font-bold leading-tight">
              {entry.name}
            </span>
            <span className="tabular mt-auto text-heading font-extrabold leading-none">
              {pct(entry.overall)}
              <span className="text-caption font-bold text-text-faint">%</span>
            </span>
            <span className="tabular text-micro text-text-faint">
              {formatCost(entry.costPerQuestion)}/question
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── Cost-vs-score map ──────────────────────────────────────────────────── */

const X_MIN = 0.002
const X_MAX = 0.15
const Y_MIN = 60
const Y_MAX = 100

function scatterX(cost: number): number {
  const t =
    (Math.log10(cost) - Math.log10(X_MIN)) /
    (Math.log10(X_MAX) - Math.log10(X_MIN))
  return Math.min(Math.max(t, 0), 1) * 100
}

function scatterY(score: number): number {
  return (1 - (score - Y_MIN) / (Y_MAX - Y_MIN)) * 100
}

function ScatterMap({ ranked }: { ranked: BenchEntry[] }) {
  return (
    <section
      className="flex flex-col gap-2 px-4"
      aria-label="Score versus cost map"
    >
      <div>
        <p className="aisle-label">The trade</p>
        <h2 className="mt-1 text-heading font-extrabold tracking-tight">
          Score vs. what it burns
        </h2>
        <p className="mt-0.5 text-caption text-text-faint">
          Up and left wins. Cost axis is logarithmic — the gaps are bigger than
          they look.
        </p>
      </div>

      <div className="card-glint rounded-xl bg-surface p-4">
        <div
          className="relative h-56"
          role="img"
          aria-label={scatterAltText(ranked)}
        >
          {/* Gridlines */}
          {[100, 90, 80, 70].map((score) => (
            <div
              key={score}
              className="absolute inset-x-0 border-t border-line/60"
              style={{ top: `${scatterY(score)}%` }}
            >
              <span className="tabular absolute -top-2 right-0 text-micro text-text-faint">
                {score}%
              </span>
            </div>
          ))}
          {/* Rank-numbered dots — text labels collide in the 96-98% cluster,
              numerals don't. The legend below maps them back to names. */}
          {ranked.map((entry, i) => {
            const left = scatterX(entry.costPerQuestion)
            const top = scatterY(pct(entry.overall))
            return (
              <span
                key={entry.id}
                className="absolute z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-mono text-[0.625rem] font-extrabold leading-none text-bg ring-2 ring-bg"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  backgroundColor: vendorColor(entry.vendor),
                }}
              >
                {i + 1}
              </span>
            )
          })}
        </div>
        {/* X ticks */}
        <div className="tabular relative mt-2 h-4 border-t border-line/60 text-micro text-text-faint">
          {[0.003, 0.01, 0.03, 0.1].map((cost) => (
            <span
              key={cost}
              className="absolute top-0.5 -translate-x-1/2"
              style={{ left: `${scatterX(cost)}%` }}
            >
              {formatCost(cost)}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-right text-micro text-text-faint">
          measured $ per question →
        </p>
        {/* Legend: number → model */}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-line pt-3">
          {ranked.map((entry, i) => (
            <span
              key={entry.id}
              className="flex items-center gap-1.5 text-micro font-semibold text-text-muted"
            >
              <span
                className="grid h-3.5 w-3.5 place-items-center rounded-full font-mono text-[0.5rem] font-extrabold leading-none text-bg"
                style={{ backgroundColor: vendorColor(entry.vendor) }}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              {entry.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function scatterAltText(ranked: BenchEntry[]): string {
  return `Scatter plot of benchmark score against cost per question: ${ranked
    .map(
      (e) => `${e.name} ${pct(e.overall)}% at ${formatCost(e.costPerQuestion)}`,
    )
    .join('; ')}.`
}

/* ── Leaderboard ────────────────────────────────────────────────────────── */

function Leaderboard({ ranked }: { ranked: BenchEntry[] }) {
  return (
    <section className="flex flex-col gap-3 px-4" aria-label="Full ranking">
      <div>
        <p className="aisle-label">Ranking</p>
        <h2 className="mt-1 text-heading font-extrabold tracking-tight">
          Every model, every cell
        </h2>
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {ranked.map((entry, i) => (
          <EntryCard key={entry.id} entry={entry} rank={i + 1} />
        ))}
      </ol>
    </section>
  )
}

function EntryCard({ entry, rank }: { entry: BenchEntry; rank: number }) {
  const score = pct(entry.overall)
  return (
    <li className="card-glint flex flex-col gap-3 rounded-xl bg-surface p-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="w-6 shrink-0 font-mono text-body-lg font-bold text-text-faint/60"
        >
          {String(rank).padStart(2, '0')}
        </span>
        <VendorLogo vendor={entry.vendor} size={32} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body font-bold">{entry.name}</span>
            {entry.tier && (
              <span className="rounded-full bg-action-subtle px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-action">
                {entry.tier}
              </span>
            )}
            {!entry.inApp && (
              <span className="rounded-full bg-raised px-2 py-0.5 text-micro font-semibold text-text-faint">
                not offered in app
              </span>
            )}
          </p>
          <p className="tabular mt-0.5 text-caption text-text-muted">
            {formatCost(entry.costPerQuestion)}/question · {entry.medianSeconds}
            s median
          </p>
        </div>
        <span className="tabular shrink-0 text-title font-extrabold leading-none">
          {score}
          <span className="text-body-sm font-bold text-text-faint">%</span>
        </span>
      </div>

      <ScoreBar
        score={entry.overall}
        label={`${entry.overall.passed} of ${entry.overall.total} questions passed`}
      />

      <p className="text-body-sm leading-relaxed text-text-muted">
        {entry.verdict}
      </p>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-line pt-3">
        <CellStat label="Easy" score={entry.difficulty.easy} />
        <CellStat label="Medium" score={entry.difficulty.medium} />
        <CellStat label="Hard" score={entry.difficulty.hard} />
        <CellStat label="Search" score={entry.concept.search} />
        <CellStat label="Compare" score={entry.concept.compare} />
        <CellStat label="Product Q&A" score={entry.concept.qa} />
      </div>
    </li>
  )
}

function ScoreBar({ score, label }: { score: CellScore; label: string }) {
  const percent = (score.passed / score.total) * 100
  return (
    <div>
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="h-2 overflow-hidden rounded-full bg-raised"
      >
        <div
          className="h-full rounded-full bg-action"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function CellStat({ label, score }: { label: string; score: CellScore }) {
  const percent = (score.passed / score.total) * 100
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between">
        <span className="text-micro font-medium tracking-wide text-text-faint">
          {label}
        </span>
        <span className="tabular text-caption font-bold">
          {score.passed}/{score.total}
        </span>
      </span>
      <div
        className="h-1 overflow-hidden rounded-full bg-raised"
        aria-hidden="true"
      >
        <div
          className={cn(
            'h-full rounded-full',
            percent >= 90 ? 'bg-ok' : percent >= 75 ? 'bg-action' : 'bg-danger',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

/* ── Disqualified ───────────────────────────────────────────────────────── */

function Disqualified({ entries }: { entries: BenchEntry[] }) {
  if (entries.length === 0) return null
  return (
    <section
      className="flex flex-col gap-3 px-4"
      aria-label="Disqualified models"
    >
      <div>
        <p className="aisle-label">Disqualified</p>
        <h2 className="mt-1 text-heading font-extrabold tracking-tight">
          0% — and not because they’re dumb
        </h2>
        <p className="mt-1 max-w-md text-body-sm leading-relaxed text-text-muted">
          Every request this app makes requires providers that neither store nor
          train on the conversation (Best Buy’s data terms demand it). These
          models have no compliant endpoint, so OpenRouter refuses every call —
          they can never answer here, at any price.
        </p>
      </div>
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center gap-3 rounded-xl bg-surface/60 p-4 opacity-70"
        >
          <CircleSlash
            size={18}
            aria-hidden="true"
            className="shrink-0 text-danger"
          />
          <VendorLogo vendor={entry.vendor} size={28} />
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-bold">{entry.name}</p>
            <p className="text-caption text-text-muted">{entry.verdict}</p>
          </div>
          <span className="tabular shrink-0 text-body-lg font-extrabold text-text-faint">
            0%
          </span>
        </div>
      ))}
    </section>
  )
}

/* ── Methodology ────────────────────────────────────────────────────────── */

const METHOD_CARDS = [
  {
    title: 'What it asks',
    body: `${BENCH_META.questionCount} questions a real floor employee would ask, across a 3×3 grid: three kinds of work (catalog search, product comparison, product Q&A) at three difficulties. Every question was grounded against the live Best Buy catalog the day it was written — “What’s the most popular 65-inch TV?” has one verifiable answer set, and the checks carry the evidence.`,
  },
  {
    title: 'How it runs',
    body: 'Every model gets the identical harness: the app’s real system prompt, the full tool registry (catalog search, product analysis, comparison, web search, store stock, cart), the live Best Buy catalog, and the same zero-data-retention provider routing production uses. If it fails here, it fails in the app — same code path.',
  },
  {
    title: 'How it scores',
    body: 'Pass/fail per question, checked mechanically: the answer must reference the right SKU or contain the grounded fact (typography-normalized so “240 Hz” ≡ “240Hz”). No LLM judge anywhere. Cost is the USD actually billed per question; speed is the median end-to-end answer time including tool calls.',
  },
  {
    title: 'How to read it',
    body: `${BENCH_META.questionCount} questions means one question ≈ 2 points — treat gaps of a question or two as noise, not ranking. This is a dated snapshot (${BENCH_META.runDate}): the catalog drifts, models update, and results are harness-dependent by design — this page answers “how does it do in THIS app,” nothing broader.`,
  },
] as const

function Methodology() {
  return (
    <section className="flex flex-col gap-3 px-4" aria-label="Methodology">
      <div>
        <p className="aisle-label">Methodology</p>
        <h2 className="mt-1 flex items-center gap-2 text-heading font-extrabold tracking-tight">
          <FlaskConical size={18} aria-hidden="true" className="text-action" />
          How the sausage is measured
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        {METHOD_CARDS.map((card) => (
          <div key={card.title} className="rounded-xl bg-surface p-4">
            <h3 className="text-body-sm font-bold">{card.title}</h3>
            <p className="mt-1 text-body-sm leading-relaxed text-text-muted">
              {card.body}
            </p>
          </div>
        ))}
      </div>
      <p className="tabular px-1 text-micro leading-relaxed text-text-faint">
        Run {BENCH_META.runDate} · {BENCH_META.questionCount} questions · ~$
        {BENCH_META.totalSpendUsd.toFixed(2)} total inference spend · cells:
        easy {BENCH_META.cells.easy} / medium {BENCH_META.cells.medium} / hard{' '}
        {BENCH_META.cells.hard} · results never edited in place — re-runs get a
        new date.
      </p>
    </section>
  )
}

/* ── Next steps ─────────────────────────────────────────────────────────── */

function NextSteps() {
  return (
    <section className="flex flex-col gap-2 px-4">
      <Link
        to="/models"
        className="card-glint flex min-h-12 items-center justify-between rounded-xl bg-surface px-4 text-body font-bold transition-transform duration-100 active:scale-[0.99]"
      >
        See the lineup these scores picked
        <ArrowRight size={16} aria-hidden="true" className="text-action" />
      </Link>
      <Link
        to="/models/guide"
        className="card-glint flex min-h-12 items-center justify-between rounded-xl bg-surface px-4 text-body font-bold transition-transform duration-100 active:scale-[0.99]"
      >
        Help me choose a model
        <ArrowRight size={16} aria-hidden="true" className="text-action" />
      </Link>
    </section>
  )
}

/* ── Shared ─────────────────────────────────────────────────────────────── */

function formatCost(cost: number): string {
  if (cost === 0) return '$0'
  if (cost < 0.01) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}
