import { SignInButton, useAuth } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, ImageOff, RotateCcw, Sparkles } from 'lucide-react'
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { BestBuyAttribution } from '#/features/about/bestbuy-attribution'
import {
  buildDefaultToolRegistry,
  createClientHost,
  type ChatMessage,
  type TurnEvent,
  userMessage,
} from '#/features/agent'
import { getCartItems } from '#/features/cart/cart-store'
import {
  FitCrossSection,
  orientationLabel,
} from '#/features/chat/components/rich-cards'
import {
  type ChatNotice,
  driveTurns,
  type TurnSink,
} from '#/features/chat/agent-transport'
import { ProductSearchBar } from '#/features/product-search/search-bar'
import { getSelectedModelId } from '#/features/models/selected-model'
import { formatPrice } from '#/lib/format-price'
import { cn } from '#/lib/utils'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import { getProductDetail } from '#/server/functions/get-product-detail'
import { searchProducts } from '#/server/functions/search-products'
import {
  extractFitVerdictFromTranscript,
  fitStageCaptionForTool,
  fitVerdictTier,
} from '#/features/willitfit/willitfit'
import type { FitVerdictSegment } from '#/features/chat/rich-cards'

interface WillItFitSearch {
  sku?: number
}

export const Route = createFileRoute('/_app/willitfit')({
  validateSearch: (search: Record<string, unknown>): WillItFitSearch => {
    const rawSku = search.sku
    const parsedSku =
      typeof rawSku === 'number'
        ? rawSku
        : typeof rawSku === 'string' && /^\d+$/.test(rawSku)
          ? Number(rawSku)
          : undefined
    return {
      sku:
        parsedSku !== undefined &&
        Number.isSafeInteger(parsedSku) &&
        parsedSku > 0
          ? parsedSku
          : undefined,
    }
  },
  component: WillItFitPage,
})

type StageRow = { caption: string; active: boolean }

const TV_CATEGORY_ID = 'abcat0101000'

const PARTICLES = [
  ['-52px', '-38px'],
  ['-36px', '-58px'],
  ['-15px', '-48px'],
  ['8px', '-62px'],
  ['30px', '-46px'],
  ['52px', '-34px'],
  ['67px', '-10px'],
  ['58px', '20px'],
  ['41px', '42px'],
  ['18px', '58px'],
  ['-9px', '51px'],
  ['-34px', '45px'],
  ['-58px', '28px'],
  ['-70px', '2px'],
  ['-62px', '-17px'],
  ['-27px', '-28px'],
  ['1px', '-31px'],
  ['28px', '-19px'],
  ['43px', '4px'],
  ['12px', '27px'],
] as const

function WillItFitPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const { sku } = Route.useSearch()

  if (!isLoaded) return null
  if (!isSignedIn) return <SignInGate />

  return <WillItFitExperience sku={sku} />
}

function WillItFitExperience({ sku }: WillItFitSearch) {
  const [pickedProduct, setPickedProduct] = useState<BestBuyProduct | null>(
    null,
  )
  const [swapping, setSwapping] = useState(false)
  const [vehicle, setVehicle] = useState('')
  const [running, setRunning] = useState(false)
  const [stages, setStages] = useState<StageRow[]>([])
  const [verdict, setVerdict] = useState<FitVerdictSegment | null>(null)
  const [fallbackText, setFallbackText] = useState<string | null>(null)
  const [notice, setNotice] = useState<ChatNotice | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const outcomeRef = useRef<HTMLDivElement>(null)

  const productDetail = useQuery({
    queryKey: ['will-it-fit-product', sku],
    enabled: sku !== undefined,
    queryFn: () => getProductDetail({ data: { sku: sku as number } }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })

  const product =
    pickedProduct ??
    (swapping || productDetail.data?.status !== 'found'
      ? null
      : productDetail.data.product)
  const host = useMemo(
    () => createClientHost(async () => ({ status: 'cancelled' as const })),
    [],
  )

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (verdict || fallbackText || notice) outcomeRef.current?.focus()
  }, [fallbackText, notice, verdict])

  const resetRun = () => {
    setVerdict(null)
    setFallbackText(null)
    setNotice(null)
    setStages([])
  }

  const invalidateRun = () => {
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
  }

  const swapContender = () => {
    invalidateRun()
    setPickedProduct(null)
    setSwapping(true)
    resetRun()
  }

  const pickContender = (nextProduct: BestBuyProduct) => {
    invalidateRun()
    setPickedProduct(nextProduct)
    setSwapping(false)
    resetRun()
  }

  const startRun = () => {
    if (!product || vehicle.trim().length === 0 || running) return

    const transcript: ChatMessage[] = [
      userMessage(
        `Run the will-it-fit check: will SKU ${product.sku} (${product.name}) fit in a ${vehicle.trim()}? Find cargo dimensions and finish with the FitVerdict.`,
      ),
    ]
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    let deliveredNotice: ChatNotice | null = null
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setVerdict(null)
    setFallbackText(null)
    setNotice(null)
    setStages([{ caption: 'CONFERRING WITH THE JUDGES', active: true }])

    const sink: TurnSink = {
      getTranscript: () => transcript,
      append: (message) => {
        transcript.push(message)
      },
      setActivity: () => {},
      setDraft: () => {},
      setNotice: (nextNotice) => {
        if (runIdRef.current !== runId) return
        deliveredNotice = nextNotice
        setNotice(nextNotice)
      },
      applyCart: () => {},
      host,
      model: getSelectedModelId(),
      toolsEnabled: buildDefaultToolRegistry().schemas.length > 0,
      getCart: getCartItems,
      onEvent: (event: TurnEvent) => {
        if (runIdRef.current !== runId) return
        if (event.type !== 'tool-start') return
        const caption = fitStageCaptionForTool(event.call.name)
        setStages((previous) => {
          const finished = previous.map((row) => ({ ...row, active: false }))
          const existing = finished.find((row) => row.caption === caption)
          if (existing) {
            return finished.map((row) =>
              row.caption === caption ? { ...row, active: true } : row,
            )
          }
          return [...finished, { caption, active: true }]
        })
      },
    }

    void driveTurns(sink, controller.signal)
      .then(() => {
        if (
          runIdRef.current !== runId ||
          controller.signal.aborted ||
          deliveredNotice !== null
        ) {
          return
        }
        setStages((previous) =>
          previous.map((row) => ({ ...row, active: false })),
        )
        const parsedVerdict = extractFitVerdictFromTranscript(transcript)
        if (parsedVerdict?.sku === product.sku) {
          setVerdict(parsedVerdict)
          return
        }
        const finalAssistant = [...transcript]
          .reverse()
          .find((message) => message.role === 'assistant')
        setFallbackText(
          finalAssistant?.content ||
            'The judges could not return a ruling. Please try again.',
        )
      })
      .finally(() => {
        if (runIdRef.current !== runId) return
        if (abortRef.current === controller) abortRef.current = null
        if (!controller.signal.aborted) setRunning(false)
      })
  }

  const showPicker = swapping || (sku === undefined && pickedProduct === null)

  return (
    <div className="will-fit-page flex flex-col gap-7 px-5 pt-4 pb-6">
      <TitleMarquee />

      <section
        className="flex flex-col gap-3"
        aria-labelledby="contender-title"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="contender-title" className="will-fit-section-title">
            The contender
          </h2>
          {(product !== null || showPicker) && <BestBuyAttribution />}
        </div>

        {product ? (
          <ContenderCard product={product} onSwap={swapContender} />
        ) : sku !== undefined && !swapping && productDetail.isPending ? (
          <ContenderSkeleton />
        ) : sku !== undefined && !swapping ? (
          <ContenderLoadFailure
            message={
              productDetail.data?.status === 'error'
                ? productDetail.data.message
                : 'That contender is no longer in the catalog.'
            }
            onSwap={swapContender}
          />
        ) : (
          <ProductPicker onPick={pickContender} />
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="arena-title">
        <h2 id="arena-title" className="will-fit-section-title">
          The arena
        </h2>

        {running ? (
          <RunStage stages={stages} />
        ) : verdict ? (
          <FitReveal
            verdict={verdict}
            product={product}
            onReset={resetRun}
            outcomeRef={outcomeRef}
          />
        ) : fallbackText ? (
          <JudgesRuling
            text={fallbackText}
            onReset={resetRun}
            outcomeRef={outcomeRef}
          />
        ) : notice ? (
          <RunNotice
            notice={notice}
            onReset={resetRun}
            outcomeRef={outcomeRef}
          />
        ) : (
          <ArenaForm
            productReady={product !== null}
            vehicle={vehicle}
            onVehicleChange={setVehicle}
            onSubmit={startRun}
          />
        )}
      </section>
    </div>
  )
}

function TitleMarquee() {
  return (
    <header className="will-fit-marquee rise-in">
      <span aria-hidden="true" className="will-fit-bulbs" />
      <p className="will-fit-kicker">Cargo bay championship</p>
      <h1 className="will-fit-title">Will it fit?!</h1>
      <p className="mt-1 max-w-72 text-body-sm font-semibold leading-relaxed text-text-muted">
        The gameshow where the cargo bay is the judge.
      </p>
    </header>
  )
}

function ContenderCard({
  product,
  onSwap,
}: {
  product: BestBuyProduct
  onSwap: () => void
}) {
  const imageUrl = product.largeImage ?? product.image ?? product.thumbnailImage
  const panelWidth = panelWidthFromProduct(product)

  return (
    <div className="will-fit-contender card-glint flex gap-3 rounded-2xl bg-surface p-3">
      <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <ImageOff size={24} aria-hidden="true" className="text-text-faint" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="aisle-label">On the mark</p>
        <p className="mt-1 line-clamp-2 text-body font-extrabold leading-snug text-text">
          {product.name}
        </p>
        <p className="mt-1 font-mono text-caption text-text-muted">
          SKU {product.sku}
        </p>
        <p className="mt-1 text-caption font-semibold text-text-muted">
          Panel width: <span className="text-text">{panelWidth}</span>
        </p>
        {!isTvProduct(product) && (
          <p className="mt-1 text-micro leading-relaxed text-text-faint">
            Not a TV, box estimate may be off.
          </p>
        )}
        <button
          type="button"
          onClick={onSwap}
          className="mt-2 text-caption font-extrabold uppercase tracking-[0.11em] text-action"
        >
          Swap contender
        </button>
      </div>
    </div>
  )
}

function ContenderSkeleton() {
  return (
    <output
      aria-label="Loading contender"
      className="flex h-30 animate-pulse rounded-2xl bg-surface"
    />
  )
}

function ContenderLoadFailure({
  message,
  onSwap,
}: {
  message: string
  onSwap: () => void
}) {
  return (
    <div className="rounded-2xl border border-danger/40 bg-danger-subtle p-4">
      <p className="text-body-sm font-bold text-danger">
        Contender unavailable
      </p>
      <p className="mt-1 text-caption leading-relaxed text-text-muted">
        {message}
      </p>
      <button
        type="button"
        onClick={onSwap}
        className="mt-3 text-caption font-extrabold uppercase tracking-[0.11em] text-action"
      >
        Choose another TV
      </button>
    </div>
  )
}

function ProductPicker({
  onPick,
}: {
  onPick: (product: BestBuyProduct) => void
}) {
  const [query, setQuery] = useState('')
  const results = useQuery({
    queryKey: ['will-it-fit-picker', query],
    enabled: query.length > 0,
    queryFn: () => searchProducts({ data: { query, page: 1 } }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const products =
    results.data?.status === 'ok'
      ? results.data.page.products.filter(isTvProduct).slice(0, 8)
      : []

  return (
    <div className="flex flex-col gap-3">
      <ProductSearchBar
        initialQuery={query}
        onSearch={(nextQuery) => setQuery(nextQuery)}
      />
      {results.isPending && (
        <output className="text-body-sm text-text-muted">
          Finding contenders...
        </output>
      )}
      {results.data?.status === 'error' && (
        <p className="text-caption text-danger">{results.data.message}</p>
      )}
      {query.length > 0 &&
        results.data?.status === 'ok' &&
        products.length === 0 && (
          <p className="text-body-sm text-text-muted">
            No contenders matched that search.
          </p>
        )}
      {products.length > 0 && (
        <ul className="flex flex-col gap-2">
          {products.map((product) => (
            <PickerRow key={product.sku} product={product} onPick={onPick} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PickerRow({
  product,
  onPick,
}: {
  product: BestBuyProduct
  onPick: (product: BestBuyProduct) => void
}) {
  const imageUrl = product.image ?? product.thumbnailImage
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(product)}
        className="card-glint flex min-h-20 w-full items-center gap-3 rounded-xl bg-surface p-2.5 text-left transition-transform duration-100 active:scale-[0.99]"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageOff
              size={18}
              aria-hidden="true"
              className="text-text-faint"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-body-sm font-bold leading-snug text-text">
            {product.name}
          </span>
          <span className="mt-1 block font-mono text-caption text-text-muted">
            SKU {product.sku}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-caption font-extrabold text-action">
            Pick
          </span>
          {product.salePrice !== null && (
            <span className="tabular mt-1 block text-caption font-bold text-text-muted">
              {formatPrice(product.salePrice)}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

function ArenaForm({
  productReady,
  vehicle,
  onVehicleChange,
  onSubmit,
}: {
  productReady: boolean
  vehicle: string
  onVehicleChange: (value: string) => void
  onSubmit: () => void
}) {
  const ready = productReady && vehicle.trim().length > 0
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="aisle-label">Vehicle</span>
        <input
          type="text"
          value={vehicle}
          onChange={(event) => onVehicleChange(event.target.value)}
          placeholder="2015 Chevy Equinox"
          autoComplete="off"
          maxLength={120}
          className="min-h-13 rounded-xl border border-line-strong bg-raised px-4 text-body-lg font-semibold text-text placeholder:text-text-faint"
        />
      </label>
      <button
        type="submit"
        disabled={!ready}
        className="will-fit-action min-h-15 w-full rounded-xl bg-action px-5 text-body-lg font-black uppercase tracking-[0.13em] text-action-ink transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Fit it!
      </button>
      {!productReady && (
        <p className="text-caption text-text-faint">
          Pick a TV to open the arena.
        </p>
      )}
    </form>
  )
}

function RunStage({ stages }: { stages: StageRow[] }) {
  return (
    <output
      aria-live="polite"
      className="will-fit-stage-list rounded-2xl bg-surface p-4"
    >
      <p className="will-fit-kicker">Live from the floor</p>
      <div className="mt-3 flex flex-col gap-3">
        {stages.map((stage) => (
          <div key={stage.caption} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'grid h-6 w-6 shrink-0 place-items-center rounded-full text-micro font-black',
                stage.active
                  ? 'bg-action-subtle text-action'
                  : 'bg-ok-subtle text-ok',
              )}
            >
              {stage.active ? <Sparkles size={13} /> : <Check size={13} />}
            </span>
            <span
              className={cn(
                'text-caption font-black tracking-[0.1em]',
                stage.active
                  ? 'status-shimmer'
                  : 'text-text-muted line-through decoration-line-strong',
              )}
            >
              {stage.caption}
            </span>
          </div>
        ))}
      </div>
    </output>
  )
}

function FitReveal({
  verdict,
  product,
  onReset,
  outcomeRef,
}: {
  verdict: FitVerdictSegment
  product: BestBuyProduct | null
  onReset: () => void
  outcomeRef: RefObject<HTMLDivElement | null>
}) {
  const reducedMotion = useReducedMotion()
  const percent = useCountUp(verdict.percentAny, reducedMotion)
  const tier = fitVerdictTier(verdict.percentAny)
  const presentation = {
    fits: {
      headline: 'IT FITS!',
      textClass: 'text-ok',
      frameClass: 'will-fit-reveal--fits border-ok/50',
    },
    tight: {
      headline: 'TIGHT! MEASURE FIRST!',
      textClass: 'will-fit-tone-gold',
      frameClass: 'will-fit-reveal--tight border-tag/45',
    },
    'no-fit': {
      headline: 'NO FIT!',
      textClass: 'text-danger',
      frameClass: 'will-fit-reveal--no-fit border-danger/50',
    },
  }[tier]

  return (
    <div
      ref={outcomeRef}
      tabIndex={-1}
      className={cn(
        'will-fit-reveal relative overflow-hidden rounded-2xl border bg-surface p-4',
        presentation.frameClass,
      )}
    >
      {tier === 'fits' && !reducedMotion && <ParticleBurst />}
      <div className="relative">
        <p className="will-fit-kicker">The reveal</p>
        <div aria-live="polite" aria-atomic="true">
          <h3 className="sr-only">
            {presentation.headline} {verdict.percentAny}% fit confidence
          </h3>
          <div aria-hidden="true">
            <h3
              className={cn(
                'will-fit-reveal-headline mt-1 text-display font-black tracking-[-0.05em]',
                presentation.textClass,
                tier === 'no-fit' && !reducedMotion && 'will-fit-buzzer',
              )}
            >
              {presentation.headline}
            </h3>
            <output
              className={cn(
                'tabular mt-3 block text-[clamp(4.5rem,24vw,7rem)] leading-none font-black tracking-[-0.1em]',
                presentation.textClass,
              )}
            >
              {percent}%
            </output>
          </div>
        </div>
        <p className="mt-2 text-body font-extrabold text-text">
          {verdict.vehicleLabel}
        </p>
        <p
          className={cn('mt-1 text-caption font-bold', presentation.textClass)}
        >
          {orientationLabel(verdict.recommended)}
        </p>
        <FitCrossSection verdict={verdict} toneClass={presentation.textClass} />
        {verdict.estimated && (
          <span className="mt-3 inline-flex rounded-full bg-raised px-2.5 py-1 text-micro font-black uppercase tracking-[0.08em] text-text-muted">
            Estimated specs
          </span>
        )}
        <p className="mt-3 text-caption leading-relaxed text-text-muted">
          Assumes rear seats folded. Panels should ride upright; flat transport
          risks damage.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={onReset}
            className="flex min-h-11 items-center gap-1.5 text-body-sm font-extrabold text-action"
          >
            <RotateCcw size={15} aria-hidden="true" />
            Run it back
          </button>
          {product && (
            <Link
              to="/product/$sku"
              params={{ sku: String(product.sku) }}
              className="text-body-sm font-extrabold text-text-muted underline decoration-line-strong underline-offset-4"
            >
              View product
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function ParticleBurst() {
  return (
    <span aria-hidden="true" className="will-fit-particle-burst">
      {PARTICLES.map(([x, y]) => (
        <span
          key={`${x}:${y}`}
          className="will-fit-particle"
          style={{ '--will-fit-x': x, '--will-fit-y': y } as CSSProperties}
        />
      ))}
    </span>
  )
}

function JudgesRuling({
  text,
  onReset,
  outcomeRef,
}: {
  text: string
  onReset: () => void
  outcomeRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={outcomeRef}
      tabIndex={-1}
      className="rounded-2xl border border-line-strong bg-surface p-4"
    >
      <p className="will-fit-kicker">Judges' ruling</p>
      <p className="mt-2 whitespace-pre-wrap text-body-sm leading-relaxed text-text-muted">
        {text}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 flex min-h-11 items-center gap-1.5 text-body-sm font-extrabold text-action"
      >
        <RotateCcw size={15} aria-hidden="true" />
        Run it back
      </button>
    </div>
  )
}

function RunNotice({
  notice,
  onReset,
  outcomeRef,
}: {
  notice: ChatNotice
  onReset: () => void
  outcomeRef: RefObject<HTMLDivElement | null>
}) {
  const limited = notice.kind === 'limit'
  return (
    <div
      ref={outcomeRef}
      tabIndex={-1}
      className={cn(
        'rounded-2xl border p-4',
        limited
          ? 'border-line-strong bg-surface'
          : 'border-danger/40 bg-danger-subtle',
      )}
    >
      <p className={cn('will-fit-kicker', !limited && 'text-danger')}>
        {limited ? 'Run paused' : 'Technical difficulties'}
      </p>
      <p className="mt-2 text-body-sm leading-relaxed text-text-muted">
        {notice.message}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 flex min-h-11 items-center gap-1.5 text-body-sm font-extrabold text-action"
      >
        <RotateCcw size={15} aria-hidden="true" />
        Run it back
      </button>
    </div>
  )
}

function panelWidthFromProduct(product: BestBuyProduct): string {
  if (product.width) return product.width
  return (
    product.details.find((detail) =>
      detail.name.toLowerCase().includes('width'),
    )?.value ?? 'Unavailable'
  )
}

function isTvProduct(product: BestBuyProduct): boolean {
  return product.categoryPath.some((category) => category.id === TV_CATEGORY_ID)
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

function useCountUp(target: number, reducedMotion: boolean): number {
  const [value, setValue] = useState(reducedMotion ? target : 0)
  useEffect(() => {
    if (reducedMotion) {
      setValue(target)
      return
    }

    const duration = 1200
    let frame = 0
    const started = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - started) / duration, 1)
      const eased = 1 - (1 - progress) ** 4
      setValue(Math.round(target * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reducedMotion, target])
  return value
}

function SignInGate() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-5 pb-24">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-action-subtle">
        <Sparkles size={24} aria-hidden="true" className="text-action" />
      </div>
      <div>
        <h1 className="text-title font-extrabold tracking-tight">
          Sign in, get 100 credits
        </h1>
        <p className="mt-1 max-w-sm text-body-sm leading-relaxed text-text-muted">
          One tap with Google and 100 free credits are yours. Check the cargo
          bay before the TV leaves the floor.
        </p>
      </div>
      <SignInButton mode="modal">
        <button
          type="button"
          className="min-h-12 max-w-sm rounded-lg bg-action text-body font-bold text-action-ink transition-transform duration-100 active:scale-[0.98]"
        >
          Continue with Google
        </button>
      </SignInButton>
      <Link to="/" className="text-body-sm font-semibold text-text-muted">
        ← Back home
      </Link>
    </div>
  )
}
