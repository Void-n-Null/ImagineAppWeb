import { SignInButton, useAuth } from '@clerk/tanstack-react-start'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowDown,
  Boxes,
  ChevronDown,
  ChevronLeft,
  EllipsisVertical,
  Gift,
  History,
  MessageCircle,
  Share,
  SquarePen,
  SquarePlus,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { BestBuyAttribution } from '#/features/about/bestbuy-attribution'
import {
  buildDefaultToolRegistry,
  createClientHost,
  type ScanOutcome,
  ToolRegistry,
} from '#/features/agent'
import { capture } from '#/features/analytics/analytics'
import { useShowToolActivity } from '#/features/chat/chat-settings'
import { ActivityPill } from '#/features/chat/components/activity-pill'
import { Composer } from '#/features/chat/components/composer'
import { MessageList } from '#/features/chat/components/messages'
import { ModelSheet } from '#/features/chat/components/model-sheet'
import { ScanSheet } from '#/features/chat/components/scan-sheet'
import { ThreadDrawer } from '#/features/chat/components/thread-drawer'
import { generateThreadId } from '#/features/chat/threads/thread-store'
import {
  useDeleteThread,
  useThreadHydration,
} from '#/features/chat/threads/use-threads'
import { useAgentChat } from '#/features/chat/use-agent-chat'
import { useScanRequest } from '#/features/chat/use-scan-request'
import {
  markWelcomeSeen,
  shouldShowWelcome,
} from '#/features/chat/welcome-flag'
import { cleanModelName } from '#/features/models/format'
import { useSelectedModel } from '#/features/models/selected-model'
import { useModelCatalog } from '#/features/models/use-model-catalog'
import { isStandalone } from '#/features/pwa/detect'
import { useInstallPrompt } from '#/features/pwa/use-install-prompt'
import { useSettingsRestore } from '#/features/settings/settings-sync'
import { useBalance } from '#/features/settings/use-balance'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_app/chat')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { thread?: string; sku?: number; q?: string } => ({
    thread:
      typeof search.thread === 'string' && search.thread.length > 0
        ? search.thread
        : undefined,
    // "Ask assistant" deep link from a product page (IMA-29): pre-attach
    // this SKU so the first question already has the product in context.
    sku:
      typeof search.sku === 'number' &&
      Number.isSafeInteger(search.sku) &&
      search.sku > 0
        ? search.sku
        : undefined,
    // Starter-chip deep link from the homepage: pre-fill the composer with
    // this question. Prefill only — never auto-send; the employee reviews.
    q:
      typeof search.q === 'string' && search.q.trim().length > 0
        ? search.q.slice(0, 500)
        : undefined,
  }),
  component: ChatPage,
})

/**
 * Thread identity lives here (IMA-9). The session component is keyed by
 * thread id, so switching threads is a clean remount (which also aborts any
 * in-flight run via the hook's unmount cleanup).
 *
 * New chats get their id BEFORE the first message: when send #1 lands we
 * just write that same id into ?thread= (replace) — the key doesn't change,
 * so the URL update can't remount a session that is mid-stream. Empty
 * threads are never persisted, so pre-minting ids costs nothing.
 */
function ChatPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const { thread: threadParam, sku: skuParam, q: qParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [draftId, setDraftId] = useState(generateThreadId)

  // Account gate first (IMA-27): identity is what the credit system meters.
  // While Clerk hydrates, render nothing gate-shaped — a flash of the
  // sign-in screen for already-signed-in users would be worse than 100ms
  // of blank.
  if (!isLoaded) return null
  if (!isSignedIn) return <SignInGate />
  // The BYOK connect gate is gone (IMA-17 Phase 2): the loop runs server-side
  // on the app's pool key, so chatting needs only a signed-in account.

  const threadId = threadParam ?? draftId

  const startNewChat = () => {
    setDraftId(generateThreadId())
    void navigate({ search: {} })
  }

  return (
    <ChatSession
      key={threadId}
      threadId={threadId}
      resume={threadParam !== undefined}
      initialAttachSku={skuParam}
      onInitialAttachConsumed={() => {
        // Drop ?sku= once attached so thread switches don't re-attach it.
        void navigate({
          search: { thread: threadParam },
          replace: true,
        })
      }}
      initialDraft={qParam}
      onInitialDraftConsumed={() => {
        // Same idea as ?sku=: consume ?q= so a reload doesn't re-fill.
        void navigate({
          search: { thread: threadParam },
          replace: true,
        })
      }}
      onFirstMessage={() => {
        if (!threadParam) {
          void navigate({ search: { thread: threadId }, replace: true })
        }
      }}
      onSelectThread={(id) => {
        if (id !== threadId) void navigate({ search: { thread: id } })
      }}
      onNewChat={startNewChat}
    />
  )
}

/** One mounted conversation: full-screen, composer owns the bottom edge. */
function ChatSession({
  threadId,
  resume,
  initialAttachSku,
  onInitialAttachConsumed,
  initialDraft,
  onInitialDraftConsumed,
  onFirstMessage,
  onSelectThread,
  onNewChat,
}: {
  threadId: string
  resume: boolean
  initialAttachSku?: number
  onInitialAttachConsumed?: () => void
  initialDraft?: string
  onInitialDraftConsumed?: () => void
  onFirstMessage: () => void
  onSelectThread: (id: string) => void
  onNewChat: () => void
}) {
  const { selectedId } = useSelectedModel()
  const catalog = useModelCatalog()
  const model = catalog.data?.models.find((m) => m.id === selectedId)
  const modelSupportsTools = model?.toolCall !== false
  const canAttachImages = model?.inputModalities.includes('image') ?? true

  // Reconcile local thread cache + user settings with the account once on
  // entering chat (IMA-31). Signed-out/offline is a silent noop inside each.
  useThreadHydration()
  useSettingsRestore()

  const { showTools, setShowTools } = useShowToolActivity()
  // Balance gates the one-time welcome (IMA-16 #368): only a granted user sees
  // "100 credits on the house" — a waitlisted user would find that a lie.
  const balance = useBalance()
  const granted = balance.data?.status === 'ok' && balance.data.granted
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modelSheetOpen, setModelSheetOpen] = useState(false)
  const scan = useScanRequest()
  const deleteThreadById = useDeleteThread()

  const chat = useAgentChat({
    host: useMemo(() => createClientHost(scan.requestScan), [scan.requestScan]),
    buildRegistry: () =>
      modelSupportsTools ? buildDefaultToolRegistry() : new ToolRegistry(),
    threadId,
    resume,
    onTurnComplete: ({ turnCount, toolsUsed, model }) => {
      capture('chat_turn_completed', {
        turn_count: turnCount,
        tools_used: toolsUsed,
        model,
      })
    },
  })

  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const stick = useStickToBottom({
    initial: 'instant',
    resize: reduceMotion ? 'instant' : 'smooth',
  })

  const handleSend: typeof chat.send = (text, attachments) => {
    if (chat.transcript.length === 0) onFirstMessage()
    capture('chat_message_sent', {
      message_length: text.length,
      ...(model ? { model: model.id } : {}),
    })
    chat.send(text, attachments)
  }

  const empty = chat.transcript.length === 0

  return (
    <div className="mx-auto flex h-dvh w-full max-w-lg flex-col">
      <ChatHeader
        modelName={model ? cleanModelName(model.name) : selectedId}
        showTools={showTools}
        setShowTools={setShowTools}
        onNewChat={onNewChat}
        hasMessages={!empty}
        onOpenThreads={() => setDrawerOpen(true)}
        onOpenModelSheet={() => setModelSheetOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <main
          ref={stick.scrollRef}
          className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain px-5"
        >
          <div ref={stick.contentRef} className="flex flex-col pt-4 pb-4">
            {chat.hydrating ? (
              <TranscriptSkeleton />
            ) : empty ? (
              <EmptyState
                disabled={chat.running}
                welcome={granted}
                onPick={(q) => handleSend(q)}
              />
            ) : (
              <MessageList
                transcript={chat.transcript}
                draft={chat.draft}
                showTools={showTools}
              />
            )}

            {chat.running && !chat.draft && chat.activity && (
              <div className={cn(!empty && 'mt-5')}>
                <ActivityPill label={chat.activity} />
              </div>
            )}

            {!modelSupportsTools && (
              <p className="mt-5 rounded-xl bg-raised px-4 py-3 text-body-sm leading-relaxed text-text-muted">
                {model?.name ?? 'This model'} can’t use tools, so the assistant
                can’t search the catalog. Pick a tool-capable model in{' '}
                <Link to="/models" className="font-bold text-action">
                  Models
                </Link>
                .
              </p>
            )}

            {chat.notice && (
              <div className="mt-5 flex flex-col gap-2 rounded-xl bg-danger-subtle px-4 py-3">
                <p className="text-body-sm font-semibold leading-relaxed text-danger">
                  {chat.notice.message}
                </p>
              </div>
            )}
          </div>
        </main>

        {/* The way back down after escaping the pin — never auto-yank. */}
        {!stick.isAtBottom && (
          <button
            type="button"
            onClick={() => void stick.scrollToBottom()}
            aria-label="Jump to latest"
            className="chrome-float rise-in absolute bottom-3 left-1/2 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full text-action active:scale-95"
          >
            <ArrowDown size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <Composer
        running={chat.running}
        canAttachImages={canAttachImages}
        initialAttachSku={initialAttachSku}
        onInitialAttachConsumed={onInitialAttachConsumed}
        initialDraft={initialDraft}
        onInitialDraftConsumed={onInitialDraftConsumed}
        onSend={(text, attachments) => {
          handleSend(text, attachments)
          // Sending declares "I'm following again" — re-pin.
          void stick.scrollToBottom()
        }}
        onStop={chat.stop}
        onScanAttach={scan.requestAttachScan}
      />

      {scan.session && (
        <ScanSheet
          session={scan.session}
          onComplete={(outcome: ScanOutcome) => scan.complete(outcome)}
        />
      )}

      <ThreadDrawer
        open={drawerOpen}
        activeThreadId={threadId}
        onClose={() => setDrawerOpen(false)}
        onSelect={(id) => {
          setDrawerOpen(false)
          onSelectThread(id)
        }}
        onNewChat={() => {
          setDrawerOpen(false)
          onNewChat()
        }}
        onDelete={(id) => {
          void deleteThreadById(id).then(() => {
            // Deleting the open conversation leaves nothing to stand on —
            // fall through to a fresh thread.
            if (id === threadId) onNewChat()
          })
        }}
      />

      <ModelSheet
        open={modelSheetOpen}
        onClose={() => setModelSheetOpen(false)}
      />
    </div>
  )
}

/* ── Header ─────────────────────────────────────────────────────────────── */

function ChatHeader({
  modelName,
  showTools,
  setShowTools,
  onNewChat,
  hasMessages,
  onOpenThreads,
  onOpenModelSheet,
}: {
  modelName: string
  showTools: boolean
  setShowTools: (value: boolean) => void
  onNewChat: () => void
  hasMessages: boolean
  onOpenThreads: () => void
  onOpenModelSheet: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    // pt inset: chat is full-screen under the iPhone status bar / Dynamic
    // Island (viewport-fit=cover); the chrome extends up to cover it.
    <header className="chrome-float z-30 flex min-h-14 shrink-0 items-center gap-1 rounded-b-2xl px-2 pt-[env(safe-area-inset-top)]">
      <Link
        to="/"
        aria-label="Back to home"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-muted active:bg-action-subtle"
      >
        <ChevronLeft size={22} aria-hidden="true" />
      </Link>

      {/* Required source mark: the product cards this chat produces are
          Best Buy API data, and the copy says so (plus "not endorsed")
          rather than hiding behind a bare logo. */}
      <BestBuyAttribution />

      <div className="min-w-0 flex-1 text-center">
        <p className="text-body font-extrabold tracking-tight">Assistant</p>
        <button
          type="button"
          onClick={onOpenModelSheet}
          className="mx-auto flex max-w-48 items-center gap-0.5 truncate text-micro font-semibold text-text-faint"
        >
          <span className="truncate">{modelName}</span>
          <ChevronDown size={11} aria-hidden="true" className="shrink-0" />
        </button>
      </div>

      <button
        type="button"
        aria-label="Chat history"
        onClick={onOpenThreads}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-muted active:bg-action-subtle"
      >
        <History size={19} aria-hidden="true" />
      </button>

      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="Chat options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="grid h-11 w-11 place-items-center rounded-full text-text-muted active:bg-action-subtle"
        >
          <EllipsisVertical size={19} aria-hidden="true" />
        </button>

        {menuOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-0 cursor-default"
              tabIndex={-1}
            />
            <div className="chrome-float absolute right-0 z-10 mt-1 w-60 rounded-xl p-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={showTools}
                onClick={() => setShowTools(!showTools)}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-2.5 active:bg-action-subtle"
              >
                <span className="text-left">
                  <span className="block text-body-sm font-bold">
                    Show tool activity
                  </span>
                  <span className="block text-micro text-text-faint">
                    Every call, args, and result
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150',
                    showTools ? 'bg-action' : 'bg-raised',
                  )}
                >
                  <span
                    className={cn(
                      'h-5 w-5 rounded-full bg-text transition-transform duration-150',
                      showTools && 'translate-x-4',
                    )}
                  />
                </span>
              </button>

              <button
                type="button"
                disabled={!hasMessages}
                onClick={() => {
                  onNewChat()
                  setMenuOpen(false)
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 text-body-sm font-bold active:bg-action-subtle disabled:opacity-40"
              >
                <SquarePen
                  size={16}
                  aria-hidden="true"
                  className="text-action"
                />
                New chat
              </button>

              {/* Model config lives here (and Settings) — not the homepage. */}
              <Link
                to="/models"
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 text-body-sm font-bold active:bg-action-subtle"
              >
                <Boxes size={16} aria-hidden="true" className="text-action" />
                Model settings
              </Link>
            </div>
          </>
        )}
      </div>
    </header>
  )
}

/* ── Hydration skeleton ─────────────────────────────────────────────────── */

/** Placeholder while a resumed thread loads from IndexedDB (a frame or
 *  two): message-shaped bars, so the layout doesn't flash empty-state. */
function TranscriptSkeleton() {
  return (
    <output aria-label="Loading conversation" className="flex flex-col gap-5">
      <div className="h-10 w-3/5 animate-pulse self-end rounded-2xl bg-raised" />
      <div className="flex w-4/5 animate-pulse flex-col gap-2">
        <div className="h-3.5 w-full rounded bg-raised" />
        <div className="h-3.5 w-11/12 rounded bg-raised" />
        <div className="h-3.5 w-2/3 rounded bg-raised" />
      </div>
      <div className="h-10 w-1/2 animate-pulse self-end rounded-2xl bg-raised" />
    </output>
  )
}

/* ── Empty state ────────────────────────────────────────────────────────── */

/** Opener pool — three are drawn at random per empty state, so the page
 *  feels alive across visits and quietly demos the tool range (search,
 *  compare, availability, price, recommendations). */
const SUGGESTIONS = [
  'What’s the most popular 65 inch TV right now?',
  'Find a soundbar under $200 that’s sold in stores',
  'Compare the two most-reviewed robot vacuums',
  'Best OLED TV deals going on right now?',
  'Show me open-box laptops under $500',
  'What’s the cheapest 75 inch TV in stock?',
  'Compare the latest iPad to the Galaxy Tab',
  'Which noise-cancelling headphones have the best reviews?',
  'Find a gaming laptop with an RTX card under $1,500',
  'What air fryers are on sale this week?',
  'Best budget monitor for a home office?',
  'Compare the PS5 Pro and the regular PS5',
  'Show me washer and dryer sets under $1,200',
  'Which MacBook fits a college student best?',
  'Find wireless earbuds under $100 with long battery life',
  'What’s the top-rated dishwasher in stock?',
  'Compare Dyson and Shark cordless vacuums',
  'Any deals on Samsung Galaxy phones right now?',
  'Best TV under $500 for a bright living room?',
  'Show me mesh Wi-Fi systems for a big house',
  'Which smartwatch pairs best with an iPhone?',
  'Find a fridge with an ice maker under $1,000',
  'What’s the most-reviewed security camera?',
  'Compare the Nintendo Switch bundles in stock',
  'Best laptop for photo editing under $1,000?',
  'Show me 4K projectors and how they stack up',
  'Which espresso machine has the best ratings?',
  'Find a portable power station for camping',
  'What headphones should a runner get?',
  'Compare front-load and top-load washers you carry',
]

/** Fisher–Yates shuffle, first three out. Called once per EmptyState mount
 *  (useState initializer) so a new chat rerolls but re-renders don’t. */
function drawSuggestions(): Array<string> {
  const pool = [...SUGGESTIONS]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 3)
}

function EmptyState({
  disabled,
  welcome,
  onPick,
}: {
  disabled: boolean
  /** Granted + first-run: swap the header for the one-time welcome (#368). */
  welcome: boolean
  onPick: (question: string) => void
}) {
  const [suggestions] = useState(drawSuggestions)
  // Resolve the welcome ONCE per mount: a granted user who hasn't seen it yet
  // gets it, and we flag it seen so it never returns (even mid-session as new
  // empty chats open). Non-granted or already-seen → the normal header.
  const [showWelcome] = useState(() => welcome && shouldShowWelcome())
  useEffect(() => {
    if (showWelcome) markWelcomeSeen()
  }, [showWelcome])

  return (
    <div className="flex flex-col items-center gap-6 pt-16 text-center">
      {showWelcome ? (
        <WelcomeHeader />
      ) : (
        <>
          <div className="rise-in grid h-16 w-16 place-items-center rounded-2xl bg-action-subtle">
            <MessageCircle
              size={28}
              aria-hidden="true"
              className="text-action"
            />
          </div>
          <div className="rise-in" style={{ animationDelay: '40ms' }}>
            <h1 className="text-title font-extrabold tracking-tight">
              Ask the floor
            </h1>
            <p className="mx-auto mt-1 max-w-64 text-body-sm leading-relaxed text-text-muted">
              Live catalog answers — search, compare, scan what’s in front of
              you.
            </p>
          </div>
        </>
      )}
      <div
        className="rise-in flex w-full max-w-sm flex-col gap-2"
        style={{ animationDelay: '80ms' }}
      >
        {suggestions.map((question) => (
          <button
            key={question}
            type="button"
            disabled={disabled}
            onClick={() => onPick(question)}
            className="card-glint min-h-12 rounded-xl bg-surface px-4 py-3 text-left text-body-sm font-semibold text-text-muted transition-transform duration-100 active:scale-[0.98] disabled:opacity-50"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The one-time welcome header (#368): "100 credits on the house" + a light
 * install nudge when the app isn't installed yet. Not the full InstallBanner
 * UX (that owns the tab routes) — chat is immersive, so a single honest line
 * is the right weight here.
 */
function WelcomeHeader() {
  const { canPrompt, promptInstall } = useInstallPrompt()
  const standalone = typeof window !== 'undefined' && isStandalone()

  return (
    <>
      <div className="rise-in grid h-16 w-16 place-items-center rounded-2xl bg-action-subtle">
        <Gift size={28} aria-hidden="true" className="text-action" />
      </div>
      <div className="rise-in" style={{ animationDelay: '40ms' }}>
        <h1 className="text-title font-extrabold tracking-tight">
          100 credits on the house
        </h1>
        <p className="mx-auto mt-1 max-w-72 text-body-sm leading-relaxed text-text-muted">
          You're in — that's a few weeks of floor questions. Ask away.
        </p>
      </div>

      {!standalone &&
        (canPrompt ? (
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="rise-in flex min-h-11 items-center gap-2 rounded-full bg-action-subtle px-4 text-body-sm font-bold text-action transition-transform duration-100 active:scale-[0.97]"
            style={{ animationDelay: '60ms' }}
          >
            <SquarePlus size={15} aria-hidden="true" />
            Add to home screen
          </button>
        ) : (
          <p
            className="rise-in flex items-center gap-1.5 text-caption text-text-faint"
            style={{ animationDelay: '60ms' }}
          >
            <Share size={13} aria-hidden="true" className="text-action" />
            Add to your home screen for one-tap access
          </p>
        ))}
    </>
  )
}

/* ── Sign-in gate ───────────────────────────────────────────────────────── */

/** Clerk gate (IMA-27): Google-only instance, so the modal is a single
 *  "Continue with Google" — one tap on the sales floor. */
function SignInGate() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-5 pb-24">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-action-subtle">
        <MessageCircle size={24} aria-hidden="true" className="text-action" />
      </div>
      <div>
        <h1 className="text-title font-extrabold tracking-tight">
          Sign in, get 100 credits
        </h1>
        <p className="mt-1 max-w-sm text-body-sm leading-relaxed text-text-muted">
          One tap with Google and 100 free credits are yours — a few weeks of
          floor questions. Blake funds the pool; no card, no catch.
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
