import {
  createFileRoute,
  Link,
  useCanGoBack,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { ArrowLeft, Check, TriangleAlert } from 'lucide-react'
import {
  type Budget,
  type Complexity,
  type GuideAnswers,
  type Patience,
  RECOMMENDED_PICKS,
  recommendModel,
  useModelCatalog,
  useSelectedModel,
} from '#/features/models'
import { PickCard } from '#/features/models/components/recommended-card'

/**
 * "Help me choose": four questions → one recommendation.
 *
 * Answers live in typed URL search params, one param per question — so the
 * browser back button IS the "previous question" button, a reload keeps your
 * place, and the result screen is shareable. Money is deliberately the last
 * question; if the user's ambitions outrun their budget, the accuracy
 * trade-off is said out loud (on the money step AND on the result).
 */
export const Route = createFileRoute('/_app/models/guide')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    c?: Complexity
    p?: 'yes' | 'no'
    s?: Patience
    b?: Budget
  } => ({
    c: isOneOf(search.c, ['simple', 'compare', 'hard'] as const),
    p: isOneOf(search.p, ['yes', 'no'] as const),
    s: isOneOf(search.s, ['instant', 'patient'] as const),
    b: isOneOf(search.b, ['best', 'cheap'] as const),
  }),
  component: GuidePage,
})

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

const TOTAL_STEPS = 4

interface OptionDef<V extends string> {
  value: V
  label: string
  hint: string
}

function GuidePage() {
  const { c, p, s, b } = Route.useSearch()

  // The current step is simply the first unanswered question.
  const step =
    c === undefined
      ? 1
      : p === undefined
        ? 2
        : s === undefined
          ? 3
          : b === undefined
            ? 4
            : 5

  return (
    <div className="flex flex-col gap-6 px-4 pt-4 pb-8">
      <GuideHeader step={step} />
      {step === 1 && <QuestionComplexity />}
      {step === 2 && <QuestionPhotos />}
      {step === 3 && <QuestionPatience />}
      {step === 4 && <QuestionBudget complexity={c as Complexity} />}
      {step === 5 && (
        <GuideResultView
          answers={{
            complexity: c as Complexity,
            photos: p === 'yes',
            patience: s as Patience,
            budget: b as Budget,
          }}
        />
      )}
    </div>
  )
}

function GuideHeader({ step }: { step: number }) {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const finished = step > TOTAL_STEPS

  return (
    <header className="flex flex-col gap-4">
      {canGoBack ? (
        <button
          type="button"
          onClick={() => router.history.back()}
          className="-ml-2 flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-body-sm font-medium text-text-muted active:bg-raised"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {step === 1 || finished ? 'Models' : 'Previous question'}
        </button>
      ) : (
        <Link
          to="/models"
          className="-ml-2 flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-body-sm font-medium text-text-muted active:bg-raised"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Models
        </Link>
      )}

      {!finished && (
        <div className="flex items-center gap-3">
          <p className="aisle-label">
            Question {step} of {TOTAL_STEPS}
          </p>
          <div className="flex gap-1" aria-hidden="true">
            {(['one', 'two', 'three', 'four'] as const).map((name, i) => (
              <span
                key={name}
                className={`h-1 w-5 rounded-full ${i < step ? 'bg-action' : 'bg-raised'}`}
              />
            ))}
          </div>
        </div>
      )}
    </header>
  )
}

/** One tappable answer. Navigates by merging its param into the URL. */
function AnswerOption<V extends string>({
  param,
  option,
}: {
  param: 'c' | 'p' | 's' | 'b'
  option: OptionDef<V>
}) {
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <button
      type="button"
      onClick={() =>
        navigate({ search: (prev) => ({ ...prev, [param]: option.value }) })
      }
      className="card-glint flex min-h-16 flex-col justify-center gap-0.5 rounded-xl bg-surface px-4 py-3 text-left transition-transform duration-100 active:scale-[0.99]"
    >
      <span className="text-body font-bold">{option.label}</span>
      <span className="text-body-sm text-text-muted">{option.hint}</span>
    </button>
  )
}

function Question({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <section className="rise-in flex flex-col gap-4">
      <div>
        <h1 className="text-title font-extrabold leading-tight tracking-tight">
          {title}
        </h1>
        {sub && <p className="mt-1 text-body-sm text-text-muted">{sub}</p>}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function QuestionComplexity() {
  const options: OptionDef<Complexity>[] = [
    {
      value: 'simple',
      label: 'Quick facts & lookups',
      hint: 'Specs, features, “does this come in white”',
    },
    {
      value: 'compare',
      label: 'Comparisons & picks',
      hint: '“Which TV for my mom” — weighing options',
    },
    {
      value: 'hard',
      label: 'The hard stuff',
      hint: 'Compatibility chains, whole-setup builds',
    },
  ]
  return (
    <Question title="What will you throw at it?">
      {options.map((o) => (
        <AnswerOption key={o.value} param="c" option={o} />
      ))}
    </Question>
  )
}

function QuestionPhotos() {
  const options: OptionDef<'yes' | 'no'>[] = [
    {
      value: 'yes',
      label: 'Yes, often',
      hint: 'Shelf tags, boxes, “what am I looking at”',
    },
    {
      value: 'no',
      label: 'Not really',
      hint: 'Mostly typing and scanning',
    },
  ]
  return (
    <Question
      title="Will you snap photos?"
      sub="Some models can read images; some are text-only."
    >
      {options.map((o) => (
        <AnswerOption key={o.value} param="p" option={o} />
      ))}
    </Question>
  )
}

function QuestionPatience() {
  const options: OptionDef<Patience>[] = [
    {
      value: 'instant',
      label: 'Instant — customer’s waiting',
      hint: 'Every second of silence is awkward',
    },
    {
      value: 'patient',
      label: 'A few seconds is fine',
      hint: 'I’d trade a beat of waiting for a better answer',
    },
  ]
  return (
    <Question title="How fast do answers need to land?">
      {options.map((o) => (
        <AnswerOption key={o.value} param="s" option={o} />
      ))}
    </Question>
  )
}

function QuestionBudget({ complexity }: { complexity: Complexity }) {
  const options: OptionDef<Budget>[] = [
    {
      value: 'cheap',
      label: 'Stretch my credits',
      hint: 'The everyday default — roughly 170 questions per grant',
    },
    {
      value: 'best',
      label: 'Whatever gives the best answer',
      hint: 'Premium picks burn credits 4–9x faster per question',
    },
  ]
  return (
    <Question
      title="Last one: spending."
      sub="Answers draw on your credit balance — pricier models mean fewer questions."
    >
      {options.map((o) => (
        <AnswerOption key={o.value} param="b" option={o} />
      ))}
      {complexity !== 'simple' && (
        <p className="flex items-start gap-2 rounded-xl bg-raised p-3 text-caption leading-relaxed text-text-muted">
          <TriangleAlert
            size={14}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-danger"
          />
          You said you’ll ask {complexity === 'hard' ? 'hard' : 'comparison'}{' '}
          questions — on our floor benchmark the budget default fumbles those
          more often than the premium picks. A few extra credits buys measured
          accuracy.
        </p>
      )}
    </Question>
  )
}

function GuideResultView({ answers }: { answers: GuideAnswers }) {
  const catalog = useModelCatalog()
  const { selectedId, select } = useSelectedModel()
  const navigate = useNavigate()

  const result = recommendModel(answers, RECOMMENDED_PICKS)
  const model = result
    ? catalog.data?.models.find((m) => m.id === result.pick.id)
    : undefined

  if (!result) return null

  return (
    <section className="rise-in flex flex-col gap-4">
      <div>
        <h1 className="text-title font-extrabold leading-tight tracking-tight">
          Your match
        </h1>
        <p className="mt-1 text-body-sm text-text-muted">
          Based on what you’ll ask, how you work, and what you’ll spend.
        </p>
      </div>

      {model ? (
        <PickCard
          model={model}
          pick={result.pick}
          selected={selectedId === model.id}
        />
      ) : (
        <output
          aria-label="Loading recommendation"
          className="card-glint h-36 animate-pulse rounded-xl bg-surface"
        />
      )}

      {result.warning && (
        <p className="flex items-start gap-2 rounded-xl bg-danger-subtle p-3.5 text-body-sm leading-relaxed">
          <TriangleAlert
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-danger"
          />
          <span>
            <strong className="text-danger">Accuracy trade-off:</strong>{' '}
            {result.warning === 'strong'
              ? 'on our floor benchmark the budget default misses about 1 in 5 hard questions; the premium picks miss about 1 in 20. If an answer matters, double-check the spec sheet — or allow a pricier model.'
              : 'comparisons mostly land on the budget default, but it fumbles roughly 1 in 8 where the step-up is near-perfect. Solid pick — expect the occasional miss.'}
          </span>
        </p>
      )}

      {result.budgetRelaxed && (
        <p className="rounded-xl bg-raised p-3.5 text-body-sm leading-relaxed text-text-muted">
          No pick fit your budget exactly, so this is the closest match one tier
          up.
        </p>
      )}

      {model && (
        <div className="flex flex-col gap-2 pt-1">
          {selectedId === model.id ? (
            <p className="card-glint flex min-h-12 items-center justify-center gap-2 rounded-lg bg-surface text-body font-bold text-text-muted">
              <Check size={18} aria-hidden="true" className="text-ok" />
              Already your model
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                select(model.id)
                navigate({ to: '/models' })
              }}
              className="min-h-12 rounded-lg bg-action text-body font-bold text-action-ink transition-transform duration-100 active:scale-[0.98]"
            >
              Use this model
            </button>
          )}
          <Link
            to="/models/guide"
            className="flex min-h-11 items-center justify-center rounded-lg text-body-sm font-medium text-text-muted active:bg-raised"
          >
            Start over
          </Link>
        </div>
      )}
    </section>
  )
}
