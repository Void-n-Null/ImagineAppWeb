import { SignInButton, useClerk, useUser } from '@clerk/tanstack-react-start'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronRight, LogOut, Sparkles } from 'lucide-react'
import { useShowToolActivity } from '#/features/chat/chat-settings'
import { cleanModelName } from '#/features/models/format'
import { useSelectedModel } from '#/features/models/selected-model'
import { useModelCatalog } from '#/features/models/use-model-catalog'
import { questionsCaption } from '#/features/settings/credits-format'
import { useBalance } from '#/features/settings/use-balance'
import { CONTACT_EMAIL, CONTACT_MAILTO } from '#/lib/contact'
import { cn } from '#/lib/utils'

/**
 * Settings (IMA-32) — the fifth dock tab, replacing Models. One scroll of
 * Price-Tag cards: Account, Credits, Model, Preferences, and a small footer.
 * The heavy lifting (email/sign-out) is Clerk's; the credits number comes
 * from the getBalance server fn via TanStack Query (IMA-16 #366).
 */
export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 px-5 pt-5 pb-4">
      <header className="rise-in">
        <p className="aisle-label">Your account</p>
        <h1 className="text-title font-extrabold tracking-tight">Settings</h1>
      </header>

      <AccountSection />
      <CreditsSection />
      <ModelSection />
      <PreferencesSection />
      <AboutFooter />
    </div>
  )
}

/* ── Section shell: eyebrow + heading, then children ──────────────────── */

function Section({
  eyebrow,
  title,
  delay,
  children,
}: {
  eyebrow: string
  title: string
  delay: number
  children: React.ReactNode
}) {
  return (
    <section
      className="rise-in flex flex-col gap-2"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div>
        <p className="aisle-label">{eyebrow}</p>
        <h2 className="mt-0.5 text-heading font-extrabold tracking-tight">
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

/* ── Account: signed-in identity + sign out, or a sign-in prompt ──────── */

function AccountSection() {
  const { isLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()

  return (
    <Section eyebrow="Account" title="Who you are" delay={40}>
      {!isLoaded ? (
        <div className="card-glint h-16 animate-pulse rounded-xl bg-surface" />
      ) : isSignedIn ? (
        <div className="card-glint flex items-center gap-3 rounded-xl bg-surface px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-bold">
              {user.fullName ?? user.primaryEmailAddress?.emailAddress ?? 'You'}
            </span>
            {user.primaryEmailAddress?.emailAddress && (
              <span className="mt-0.5 block truncate text-caption text-text-muted">
                {user.primaryEmailAddress.emailAddress}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-body-sm font-bold text-text-muted transition-transform duration-100 active:scale-[0.97] active:bg-raised"
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : (
        <div className="card-glint flex flex-col gap-3 rounded-xl bg-surface p-4">
          <p className="text-body-sm leading-relaxed text-text-muted">
            Sign in with Google to save your chats and unlock credits — they
            follow your account across devices.
          </p>
          <SignInButton mode="modal">
            <button
              type="button"
              className="min-h-12 rounded-lg bg-action text-body font-bold text-action-ink transition-transform duration-100 active:scale-[0.98]"
            >
              Continue with Google
            </button>
          </SignInButton>
        </div>
      )}
    </Section>
  )
}

/* ── Credits: the big number + honest state copy ──────────────────────── */

function CreditsSection() {
  const balance = useBalance()
  // The questions caption estimates against the CURRENTLY SELECTED model
  // (IMA-16 #366) — same resolution the Model row uses below.
  const { selectedId } = useSelectedModel()
  const catalog = useModelCatalog()
  const model = catalog.data?.models.find((m) => m.id === selectedId)

  return (
    <Section eyebrow="Credits" title="Your balance" delay={80}>
      <div className="card-glint flex flex-col gap-1 rounded-xl bg-surface px-4 py-4">
        <CreditsBody
          isPending={balance.isPending}
          data={balance.data}
          modelPricing={
            model
              ? { input: model.cost.input, output: model.cost.output }
              : undefined
          }
          modelName={model ? cleanModelName(model.name) : undefined}
        />
      </div>
    </Section>
  )
}

function CreditsBody({
  isPending,
  data,
  modelPricing,
  modelName,
}: {
  isPending: boolean
  data: ReturnType<typeof useBalance>['data']
  modelPricing?: {
    input: number | null | undefined
    output: number | null | undefined
  }
  modelName?: string
}) {
  if (isPending && !data) {
    return (
      <>
        <div className="h-9 w-24 animate-pulse rounded bg-raised" />
        <div className="mt-1 h-3.5 w-32 animate-pulse rounded bg-raised" />
      </>
    )
  }

  // Signed out (or the query hasn't resolved to a user): a gentle nudge, not
  // a zero balance that reads as "you're broke."
  if (!data || data.status === 'signed_out') {
    return (
      <p className="text-body-sm leading-relaxed text-text-muted">
        Sign in above to see your credits.
      </p>
    )
  }

  const { credits, granted } = data

  // Waitlisted: no grant yet — the pool is full, they're in the FIFO queue.
  if (!granted) {
    return (
      <>
        <p className="tabular text-display font-extrabold leading-none text-text-muted">
          —
        </p>
        <p className="mt-2 text-body-sm leading-relaxed text-text-muted">
          You're on the waitlist — credits unlock as the pool refills.
        </p>
      </>
    )
  }

  // Granted but empty: out of credits.
  if (credits <= 0) {
    return (
      <>
        <p className="tabular text-display font-extrabold leading-none">0</p>
        <p className="mt-2 text-body-sm leading-relaxed text-text-muted">
          Out of credits. Ask Blake for a top-up:{' '}
          <a href={CONTACT_MAILTO} className="font-semibold text-action">
            {CONTACT_EMAIL}
          </a>
        </p>
      </>
    )
  }

  // The happy path: a real number + roughly-N-questions caption.
  return (
    <>
      <p className="tabular text-display font-extrabold leading-none text-action">
        {credits}
        <span className="ml-1.5 align-baseline text-body font-bold text-text-faint">
          credits
        </span>
      </p>
      {/* Model-aware estimate: scales the measured flash-lite anchor by the
          selected model's relative pricing. "about" carries the hedge — model
          spend varies (IMA-16 #366). Falls back to flat wording without a
          priced model. */}
      <p className="mt-2 text-body-sm text-text-muted">
        {questionsCaption(credits, modelPricing, modelName)}
      </p>
    </>
  )
}

/* ── Model: a row into /models showing the current pick ───────────────── */

function ModelSection() {
  const { selectedId } = useSelectedModel()
  const catalog = useModelCatalog()
  const model = catalog.data?.models.find((m) => m.id === selectedId)
  // cleanModelName wants a display name (like the home YourModel card); fall
  // back to the raw id until the catalog lands.
  const label = model ? cleanModelName(model.name) : selectedId

  return (
    <Section eyebrow="Model" title="The brain" delay={120}>
      <Link
        to="/models"
        className="card-glint flex min-h-16 items-center gap-3 rounded-xl bg-surface px-4 py-3 transition-transform duration-100 active:scale-[0.99]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-caption text-text-faint">
            Current model
          </span>
          <span className="mt-0.5 block truncate text-body font-bold">
            {label}
          </span>
        </span>
        <ChevronRight
          size={18}
          aria-hidden="true"
          className="text-text-faint"
        />
      </Link>
    </Section>
  )
}

/* ── Preferences: the tool-activity switch (one source of truth) ──────── */

function PreferencesSection() {
  const { showTools, setShowTools } = useShowToolActivity()

  return (
    <Section eyebrow="Preferences" title="How chat behaves" delay={160}>
      <div className="card-glint rounded-xl bg-surface p-2">
        {/* Same switch pattern as the chat header menu — shared hook, so a
            flip here and a flip there stay in lockstep. */}
        <button
          type="button"
          role="switch"
          aria-checked={showTools}
          onClick={() => setShowTools(!showTools)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 active:bg-action-subtle"
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
      </div>
    </Section>
  )
}

/* ── Footer: quiet identity line ──────────────────────────────────────── */

function AboutFooter() {
  return (
    <footer
      className="rise-in flex flex-col items-center gap-1 pt-2 text-center"
      style={{ animationDelay: '200ms' }}
    >
      <span className="flex items-center gap-1.5 text-caption font-semibold text-text-faint">
        <Sparkles size={13} aria-hidden="true" className="text-action" />
        Imagine App
      </span>
      <span className="text-micro text-text-faint">
        Built for the floor · v2
      </span>
      {/* py-2 keeps a usable tap target on micro text. */}
      <a
        href={CONTACT_MAILTO}
        className="px-3 py-2 text-micro font-semibold text-text-muted underline decoration-line-strong underline-offset-2"
      >
        {CONTACT_EMAIL}
      </a>
    </footer>
  )
}
