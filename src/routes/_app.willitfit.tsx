import { SignInButton, useAuth } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ImageOff, RotateCcw, Sparkles, X } from 'lucide-react'
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
  type ChatNotice,
  driveTurns,
  type TurnSink,
} from '#/features/chat/agent-transport'
import {
  FitCrossSection,
  orientationLabel,
} from '#/features/chat/components/rich-cards'
import type { FitVerdictSegment } from '#/features/chat/rich-cards'
import { ProductSearchBar } from '#/features/product-search/search-bar'
import { getSelectedModelId } from '#/features/models/selected-model'
import {
  extractFitVerdictFromTranscript,
  fitStageCaptionForTool,
  fitVerdictTier,
} from '#/features/willitfit/willitfit'
import { formatPrice } from '#/lib/format-price'
import { cn } from '#/lib/utils'
import type { BestBuyProduct } from '#/server/bestbuy/types'
import { getProductDetail } from '#/server/functions/get-product-detail'
import { searchProducts } from '#/server/functions/search-products'

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

/** What the scoreboard is currently showing. */
type BoardState =
  | { kind: 'idle' }
  | { kind: 'running'; caption: string; completed: number }
  | { kind: 'verdict'; verdict: FitVerdictSegment }
  | { kind: 'ruling'; text: string }
  | { kind: 'notice'; notice: ChatNotice }

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
  const [stageCaption, setStageCaption] = useState('')
  const [stagesDone, setStagesDone] = useState(0)
  const [verdict, setVerdict] = useState<FitVerdictSegment | null>(null)
  const [fallbackText, setFallbackText] = useState<string | null>(null)
  const [notice, setNotice] = useState<ChatNotice | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const boardRef = useRef<HTMLDivElement>(null)

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
    if (verdict || fallbackText || notice) boardRef.current?.focus()
  }, [fallbackText, notice, verdict])

  const resetRun = () => {
    setVerdict(null)
    setFallbackText(null)
    setNotice(null)
    setStageCaption('')
    setStagesDone(0)
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
    const seenCaptions = new Set<string>()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    resetRun()
    setStageCaption('Taking the stage')

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
        if (!seenCaptions.has(caption)) {
          setStagesDone(seenCaptions.size)
          seenCaptions.add(caption)
        }
        setStageCaption(caption)
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
            'No ruling this round. Please try again.',
        )
      })
      .finally(() => {
        if (runIdRef.current !== runId) return
        if (abortRef.current === controller) abortRef.current = null
        if (!controller.signal.aborted) setRunning(false)
      })
  }

  const showPicker = swapping || (sku === undefined && pickedProduct === null)
  const boardState: BoardState = running
    ? { kind: 'running', caption: stageCaption, completed: stagesDone }
    : verdict
      ? { kind: 'verdict', verdict }
      : fallbackText
        ? { kind: 'ruling', text: fallbackText }
        : notice
          ? { kind: 'notice', notice }
          : { kind: 'idle' }

  return (
    <div className="wif-page flex flex-col px-5 pt-5 pb-6">
      <Masthead />

      <Board state={boardState} boardRef={boardRef} />

      {verdict ? (
        <VerdictDetails
          verdict={verdict}
          product={product}
          onReset={resetRun}
        />
      ) : fallbackText || notice ? (
        <div className="mt-5 flex justify-center">
          <RunAgain onReset={resetRun} />
        </div>
      ) : (
        <>
          <MatchupStrip
            product={product}
            productPending={
              sku !== undefined && !swapping && productDetail.isPending
            }
            loadFailure={
              sku !== undefined &&
              !swapping &&
              !productDetail.isPending &&
              product === null
                ? productDetail.data?.status === 'error'
                  ? productDetail.data.message
                  : 'That product is no longer in the catalog.'
                : null
            }
            vehicle={vehicle}
            onVehicleChange={setVehicle}
            onSwap={swapContender}
            running={running}
          />

          {showPicker && !running && <ProductPicker onPick={pickContender} />}

          <button
            type="button"
            onClick={startRun}
            disabled={!product || vehicle.trim().length === 0 || running}
            className="wif-run mt-5 min-h-15 w-full rounded-xl bg-action text-body-lg font-black uppercase tracking-[0.14em] text-action-ink transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {running ? 'Checking...' : 'Run the check'}
          </button>
        </>
      )}
    </div>
  )
}

function Masthead() {
  return (
    <header className="flex items-baseline justify-between gap-3">
      <div>
        <h1 className="wif-wordmark">
          Will it fit<span className="wif-wordmark-mark">?</span>
        </h1>
        <p className="mt-0.5 text-micro font-bold uppercase tracking-[0.18em] text-text-faint">
          Live cargo check
        </p>
      </div>
      <span aria-hidden="true" className="wif-onair">
        On air
      </span>
    </header>
  )
}

/**
 * The scoreboard. One stage, always on screen, always where the number
 * lives: ?? before the run, scrambling digits during it, the verdict lands
 * in the exact same spot at full scale.
 */
function Board({
  state,
  boardRef,
}: {
  state: BoardState
  boardRef: RefObject<HTMLDivElement | null>
}) {
  const reducedMotion = useReducedMotion()
  const tier =
    state.kind === 'verdict' ? fitVerdictTier(state.verdict.percentAny) : null
  const tone =
    tier === 'fits'
      ? 'text-ok'
      : tier === 'tight'
        ? 'wif-gold'
        : tier === 'no-fit'
          ? 'text-danger'
          : 'wif-dim'

  return (
    <div
      ref={boardRef}
      tabIndex={-1}
      className={cn(
        'wif-board relative mt-4 flex flex-col items-center justify-center overflow-hidden text-center outline-none',
        tier === 'fits' && 'wif-board--lit',
      )}
    >
      {tier === 'fits' && !reducedMotion && <ParticleBurst />}

      <div aria-live="polite" aria-atomic="true" className="relative">
        {state.kind === 'verdict' ? (
          <BoardVerdict
            verdict={state.verdict}
            tier={tier as Exclude<typeof tier, null>}
            tone={tone}
            reducedMotion={reducedMotion}
          />
        ) : state.kind === 'ruling' ? (
          <BoardMessage
            title="No ruling"
            body={state.text}
            toneClass="wif-gold"
          />
        ) : state.kind === 'notice' ? (
          <BoardMessage
            title={
              state.notice.kind === 'limit'
                ? 'Run paused'
                : 'Technical difficulties'
            }
            body={state.notice.message}
            toneClass={
              state.notice.kind === 'limit' ? 'wif-gold' : 'text-danger'
            }
          />
        ) : (
          <>
            <BoardDigits
              state={state}
              reducedMotion={reducedMotion}
              tone={tone}
            />
            {state.kind === 'running' ? (
              <LowerThird caption={state.caption} completed={state.completed} />
            ) : (
              <p className="mt-2 text-caption font-semibold text-text-faint">
                Pick a TV, name the car, and the board decides.
              </p>
            )}
          </>
        )}
      </div>

      <span aria-hidden="true" className="wif-board-shelf" />
    </div>
  )
}

/** Idle ?? or the scramble while the check runs. Decorative, hidden from AT. */
function BoardDigits({
  state,
  reducedMotion,
  tone,
}: {
  state: BoardState
  reducedMotion: boolean
  tone: string
}) {
  const scramble = useScramble(state.kind === 'running' && !reducedMotion)

  return (
    <div aria-hidden="true" className={cn('wif-digits tabular', tone)}>
      {state.kind === 'running' ? (
        <>
          {reducedMotion ? '··' : scramble}
          <span className="wif-digits-unit">%</span>
        </>
      ) : (
        '??'
      )}
    </div>
  )
}

function BoardVerdict({
  verdict,
  tier,
  tone,
  reducedMotion,
}: {
  verdict: FitVerdictSegment
  tier: 'fits' | 'tight' | 'no-fit'
  tone: string
  reducedMotion: boolean
}) {
  const percent = useCountUp(verdict.percentAny, reducedMotion)
  const stamp = {
    fits: 'It fits',
    tight: 'Tight. Measure first',
    'no-fit': 'No fit',
  }[tier]

  return (
    <>
      <h2 className="sr-only">
        {stamp}. {verdict.percentAny}% fit confidence for{' '}
        {verdict.vehicleLabel}.
      </h2>
      <div aria-hidden="true">
        <div
          className={cn(
            'wif-digits tabular',
            tone,
            tier === 'no-fit' && !reducedMotion && 'wif-buzzer',
          )}
        >
          {percent}
          <span className="wif-digits-unit">%</span>
        </div>
        <p className={cn('wif-stamp', `wif-stamp--${tier}`)}>{stamp}</p>
      </div>
      <p className="mt-3 text-body font-extrabold text-text">
        {verdict.vehicleLabel}
      </p>
      <p className={cn('mt-0.5 text-caption font-bold', tone)}>
        {orientationLabel(verdict.recommended)}
      </p>
    </>
  )
}

function BoardMessage({
  title,
  body,
  toneClass,
}: {
  title: string
  body: string
  toneClass: string
}) {
  return (
    <div className="max-w-sm px-2">
      <p
        className={cn(
          'text-heading font-black uppercase tracking-[0.08em]',
          toneClass,
        )}
      >
        {title}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-left text-body-sm leading-relaxed text-text-muted">
        {body}
      </p>
    </div>
  )
}

/** Broadcast lower-third: one line, replaced as stages advance. */
function LowerThird({
  caption,
  completed,
}: {
  caption: string
  completed: number
}) {
  return (
    <div className="mt-2 flex flex-col items-center gap-1.5">
      <p className="status-shimmer text-caption font-black uppercase tracking-[0.14em]">
        {caption}
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((step) => (
          <span
            key={step}
            className={cn(
              'h-1 w-5 rounded-full transition-colors duration-300',
              step < completed ? 'wif-tick--done' : 'wif-tick',
            )}
          />
        ))}
      </div>
    </div>
  )
}

/** The TV and the car, face to face. */
function MatchupStrip({
  product,
  productPending,
  loadFailure,
  vehicle,
  onVehicleChange,
  onSwap,
  running,
}: {
  product: BestBuyProduct | null
  productPending: boolean
  loadFailure: string | null
  vehicle: string
  onVehicleChange: (value: string) => void
  onSwap: () => void
  running: boolean
}) {
  return (
    <div className="mt-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2.5">
        <div className="wif-slot">
          <p className="wif-slot-label">The TV</p>
          {product ? (
            <TvChip product={product} onSwap={onSwap} disabled={running} />
          ) : productPending ? (
            <output
              aria-label="Loading product"
              className="mt-1.5 block h-11 animate-pulse rounded-lg bg-raised"
            />
          ) : loadFailure ? (
            <div className="mt-1.5">
              <p className="text-caption leading-snug text-danger">
                {loadFailure}
              </p>
              <button
                type="button"
                onClick={onSwap}
                className="mt-1 text-caption font-extrabold text-action"
              >
                Pick another
              </button>
            </div>
          ) : (
            <p className="mt-1.5 text-caption leading-snug text-text-faint">
              Search below to put a TV on the board.
            </p>
          )}
        </div>

        <span aria-hidden="true" className="wif-vs self-center">
          vs
        </span>

        <div className="wif-slot">
          <label className="block">
            <span className="wif-slot-label">The car</span>
            <input
              type="text"
              value={vehicle}
              onChange={(event) => onVehicleChange(event.target.value)}
              placeholder="2015 Chevy Equinox"
              autoComplete="off"
              maxLength={120}
              disabled={running}
              className="mt-1.5 w-full bg-transparent text-body-lg font-bold text-text outline-none placeholder:font-semibold placeholder:text-text-faint"
            />
          </label>
        </div>
      </div>

      {product !== null && (
        <div className="mt-2 flex items-center justify-between gap-3">
          {!isTvProduct(product) ? (
            <p className="text-micro leading-snug text-text-faint">
              Not a TV, box estimate may be off.
            </p>
          ) : (
            <span />
          )}
          <BestBuyAttribution />
        </div>
      )}
    </div>
  )
}

function TvChip({
  product,
  onSwap,
  disabled,
}: {
  product: BestBuyProduct
  onSwap: () => void
  disabled: boolean
}) {
  const imageUrl = product.image ?? product.thumbnailImage
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <ImageOff size={16} aria-hidden="true" className="text-text-faint" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-caption font-bold leading-snug text-text">
          {product.name}
        </span>
        <span className="mt-0.5 block font-mono text-micro text-text-faint">
          SKU {product.sku}
        </span>
      </span>
      <button
        type="button"
        onClick={onSwap}
        disabled={disabled}
        aria-label="Swap TV"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-faint transition-colors hover:text-text disabled:opacity-40"
      >
        <X size={15} aria-hidden="true" />
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
    <div className="mt-3 flex flex-col gap-2.5">
      <ProductSearchBar
        initialQuery={query}
        onSearch={(nextQuery) => setQuery(nextQuery)}
      />
      {query.length > 0 && results.isPending && (
        <output className="text-body-sm text-text-muted">Searching...</output>
      )}
      {results.data?.status === 'error' && (
        <p className="text-caption text-danger">{results.data.message}</p>
      )}
      {query.length > 0 &&
        results.data?.status === 'ok' &&
        products.length === 0 && (
          <p className="text-body-sm text-text-muted">
            No TVs matched that search.
          </p>
        )}
      {products.length > 0 && (
        <ul className="flex flex-col gap-1.5">
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
        className="flex min-h-16 w-full items-center gap-3 rounded-xl bg-surface px-3 py-2 text-left transition-transform duration-100 active:scale-[0.99]"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
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
          <span className="mt-0.5 block font-mono text-micro text-text-faint">
            SKU {product.sku}
          </span>
        </span>
        {product.salePrice !== null && (
          <span className="tabular shrink-0 text-caption font-bold text-text-muted">
            {formatPrice(product.salePrice)}
          </span>
        )}
      </button>
    </li>
  )
}

/** Everything under the board once a verdict lands. */
function VerdictDetails({
  verdict,
  product,
  onReset,
}: {
  verdict: FitVerdictSegment
  product: BestBuyProduct | null
  onReset: () => void
}) {
  const tier = fitVerdictTier(verdict.percentAny)
  const tone =
    tier === 'fits' ? 'text-ok' : tier === 'tight' ? 'wif-gold' : 'text-danger'

  return (
    <div className="mt-5 flex flex-col items-center">
      <FitCrossSection verdict={verdict} toneClass={tone} />
      {verdict.estimated && (
        <span className="mt-3 inline-flex rounded-full bg-raised px-2.5 py-1 text-micro font-black uppercase tracking-[0.08em] text-text-muted">
          Estimated specs
        </span>
      )}
      <p className="mt-3 max-w-sm text-center text-caption leading-relaxed text-text-muted">
        Assumes rear seats folded. Panels should ride upright; flat transport
        risks damage.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <RunAgain onReset={onReset} />
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
      <div className="mt-4">
        <BestBuyAttribution />
      </div>
    </div>
  )
}

function RunAgain({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="flex min-h-11 items-center gap-1.5 text-body-sm font-extrabold text-action"
    >
      <RotateCcw size={15} aria-hidden="true" />
      Run it again
    </button>
  )
}

function ParticleBurst() {
  return (
    <span aria-hidden="true" className="wif-burst">
      {PARTICLES.map(([x, y]) => (
        <span
          key={`${x}:${y}`}
          className="wif-particle"
          style={{ '--wif-x': x, '--wif-y': y } as CSSProperties}
        />
      ))}
    </span>
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

/** Slot-machine digits while the check runs. Decorative only. */
function useScramble(active: boolean): string {
  const [value, setValue] = useState('00')
  useEffect(() => {
    if (!active) return
    const interval = setInterval(() => {
      setValue(String(Math.floor(Math.random() * 100)).padStart(2, '0'))
    }, 90)
    return () => clearInterval(interval)
  }, [active])
  return value
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
