import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ChevronRight,
  History,
  ImageOff,
  Info,
  MessageCircle,
  ScanBarcode,
} from 'lucide-react'
import { useState } from 'react'
import { AboutSheet } from '#/features/about/about-sheet'
import { BestBuyAttribution } from '#/features/about/bestbuy-attribution'
import { useThreadList } from '#/features/chat/threads/use-threads'
import { useRecentProducts } from '#/features/product-detail/recently-viewed'
import { AskBar } from '#/features/product-search/ask-bar'
import { CONTACT_EMAIL, CONTACT_MAILTO } from '#/lib/contact'
import { formatPrice } from '#/lib/format-price'

export const Route = createFileRoute('/_app/')({ component: HomePage })

/**
 * The homepage is a retrieval instrument (IMA-DOC-5): an employee mid-
 * conversation lands here to get to ONE product, fast. Three paths, in
 * order: type it (ask bar), point the camera at it (Scan), or talk it
 * through (Ask Imagine + starter chips). Recents keep the last few SKUs
 * one tap away. Model configuration lives in chat/settings — not here.
 */
function HomePage() {
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <div className="flex flex-col px-5 pt-6">
      <Hero />

      {/* The anchor: one field that sorts out names, SKUs, and UPCs. */}
      <section className="rise-in mt-7" style={{ animationDelay: '60ms' }}>
        <AskBar />
      </section>

      <ScanCta />
      <ChatCta />
      <RecentLookups />

      {/* Third-party status, said three ways: the hero's fine print, this
          row, and the legal line. The sheet tells the rest of the story. */}
      <footer
        className="rise-in mt-10 flex flex-col gap-3 pb-2"
        style={{ animationDelay: '200ms' }}
      >
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="card-glint flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left transition-transform duration-100 active:scale-[0.99]"
        >
          <Info
            size={18}
            aria-hidden="true"
            className="shrink-0 text-text-faint"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm font-bold">
              Not a Best Buy app
            </span>
            <span className="block text-caption text-text-muted">
              Independent, built on public data. Tap for the story.
            </span>
          </span>
          <ChevronRight
            size={16}
            aria-hidden="true"
            className="shrink-0 text-text-faint"
          />
        </button>
        <p className="mx-auto max-w-xs text-center text-micro leading-relaxed text-text-faint">
          Imagine App is not owned by, distributed by, or endorsed by Best Buy.
        </p>
        {/* Contact on the surface, no tap required: the About sheet has the
            long version, but someone skimming the footer (or from corporate)
            should find a human without digging. */}
        <div className="mx-auto -mt-1 flex items-center gap-1 text-center text-micro font-semibold text-text-muted">
          <a
            href={CONTACT_MAILTO}
            className="inline-block px-3 py-2 underline decoration-line-strong underline-offset-2"
          >
            {CONTACT_EMAIL}
          </a>
          <span aria-hidden="true" className="text-text-faint">
            &middot;
          </span>
          <Link
            to="/privacy"
            className="inline-block px-3 py-2 underline decoration-line-strong underline-offset-2"
          >
            Privacy
          </Link>
        </div>
      </footer>

      <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}

/* ── Hero: v1's tagline on a price tag. The "?" is the yellow. ─────────── */

function Hero() {
  return (
    <header className="rise-in">
      <div className="flex items-center justify-between">
        <p className="aisle-label">Floor assistant</p>
        {/* Required source mark, top corner: recents below are catalog
            data. -my keeps the 44px hit area from inflating the label row. */}
        <BestBuyAttribution className="-my-3" />
      </div>
      <p className="mt-6 text-title font-light leading-tight tracking-tight text-text-muted">
        What can I help you
      </p>
      <h1 className="text-[clamp(2.625rem,12vw,3.25rem)] font-black leading-[1.02] tracking-tight">
        Imagine<span className="text-tag">?</span>
      </h1>
      {/* The tag's barcode, with its fine print: every real shelf tag has
          some. Ours states what this app is. */}
      <BarcodeStrip className="mt-3 h-3.5 w-36 text-line-strong" />
      <p className="mt-1.5 text-micro tracking-wide text-text-faint">
        Independent third-party app · public data only
      </p>
    </header>
  )
}

/** Decorative UPC-style bars (fixed pattern, so SSR and client agree). */
function BarcodeStrip({ className }: { className?: string }) {
  // biome-ignore format: the pattern reads better on one line
  const bars = [2, 1, 1, 3, 1, 2, 1, 1, 4, 1, 2, 1, 3, 1, 1, 2, 1, 4, 1, 1, 2, 3, 1, 1, 2]
  let x = 0
  return (
    <svg
      viewBox="0 0 60 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      {bars.map((width, index) => {
        const bar = (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative pattern
            key={index}
            x={x}
            y={0}
            width={width}
            height={12}
            fill={index % 2 === 0 ? 'currentColor' : 'none'}
          />
        )
        x += width
        return bar
      })}
    </svg>
  )
}

/* ── Scan: the camera path, still the biggest thing on the page ────────── */

function ScanCta() {
  return (
    <section className="rise-in mt-4" style={{ animationDelay: '100ms' }}>
      <Link
        to="/scan"
        className="card-glint flex items-center gap-4 rounded-2xl bg-action p-5 text-action-ink transition-transform duration-100 active:scale-[0.99]"
      >
        <ScanBarcode size={30} aria-hidden="true" />
        <span>
          <span className="block text-body-lg font-extrabold">Scan</span>
          <span className="block text-body-sm opacity-80">
            Barcodes · QR · shelf tags
          </span>
        </span>
        <ChevronRight
          size={20}
          aria-hidden="true"
          className="ml-auto opacity-70"
        />
      </Link>
    </section>
  )
}

/* ── Ask Imagine: the conversation path. The card opens a fresh chat;
      the chips underneath resume the last one or prefill a question. ────── */

const STARTERS = [
  {
    label: 'Compare OLED vs QLED',
    q: 'Compare OLED vs QLED for a bright living room',
  },
  {
    label: 'Soundbar under $300',
    q: 'Best soundbar under $300 that’s sold in stores',
  },
  {
    label: 'Which HDMI for PS5?',
    q: 'Which HDMI cable does a PS5 need for 4K 120Hz?',
  },
] as const

function ChatCta() {
  const lastThread = useThreadList().data?.[0]

  return (
    <section
      className="rise-in mt-2.5 flex flex-col gap-2.5"
      style={{ animationDelay: '130ms' }}
    >
      <Link
        to="/chat"
        className="chrome-float flex items-center gap-4 rounded-2xl p-5 transition-transform duration-100 active:scale-[0.99]"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-action-subtle text-action">
          <MessageCircle size={21} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-body-lg font-extrabold">Ask Imagine</span>
          <span className="block text-body-sm text-text-muted">
            Compares specs, checks stock, explains jargon
          </span>
        </span>
        <ChevronRight
          size={20}
          aria-hidden="true"
          className="ml-auto shrink-0 text-text-faint"
        />
      </Link>

      <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5">
        {lastThread && (
          <Link
            to="/chat"
            search={{ thread: lastThread.id }}
            className="card-glint flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-action-subtle px-3.5 text-body-sm font-bold text-action transition-transform duration-100 active:scale-95"
          >
            <History size={14} aria-hidden="true" />
            <span className="max-w-36 truncate">{lastThread.title}</span>
          </Link>
        )}
        {STARTERS.map((starter) => (
          <Link
            key={starter.label}
            to="/chat"
            search={{ q: starter.q }}
            className="card-glint flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-body-sm font-semibold text-text-muted transition-transform duration-100 active:scale-95"
          >
            <MessageCircle
              size={14}
              aria-hidden="true"
              className="text-action"
            />
            {starter.label}
          </Link>
        ))}
      </div>
    </section>
  )
}

/* ── Recent lookups: v1's recall list, back. The floor bounces between
      two or three SKUs — this keeps them one tap away. ──────────────────── */

const HOME_RECENTS = 5

function RecentLookups() {
  const recents = useRecentProducts().slice(0, HOME_RECENTS)

  return (
    <section
      className="rise-in mt-9 flex flex-col gap-2.5"
      style={{ animationDelay: '170ms' }}
    >
      <h2 className="aisle-label">Recent lookups</h2>

      {recents.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-line px-6 py-7 text-center">
          <History size={20} aria-hidden="true" className="text-text-faint" />
          <p className="text-body-sm font-semibold text-text-muted">
            Nothing yet
          </p>
          <p className="max-w-52 text-caption leading-relaxed text-text-faint">
            Scan a shelf tag or search — products you pull up land here.
          </p>
        </div>
      ) : (
        <div className="card-glint overflow-hidden rounded-2xl bg-surface">
          {recents.map((item) => (
            <Link
              key={item.sku}
              to="/product/$sku"
              params={{ sku: String(item.sku) }}
              className="flex items-center gap-3 border-b border-line px-3 py-2.5 transition-colors duration-100 last:border-0 active:bg-raised"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1">
                {item.image ? (
                  <img
                    src={item.image}
                    alt=""
                    loading="lazy"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <ImageOff
                    size={15}
                    aria-hidden="true"
                    className="text-text-faint"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold">
                  {item.name}
                </span>
                <span className="tabular mt-0.5 block text-caption text-text-faint">
                  SKU {item.sku}
                </span>
              </span>
              {item.price !== null && (
                <span className="tabular shrink-0 text-body font-bold">
                  {formatPrice(item.price)}
                </span>
              )}
              <ChevronRight
                size={16}
                aria-hidden="true"
                className="shrink-0 text-text-faint"
              />
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
