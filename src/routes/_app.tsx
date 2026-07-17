import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import {
  House,
  MessageCircle,
  ScanBarcode,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import { useCart } from '#/features/cart/cart-store'
import { InstallBanner } from '#/features/pwa/install-banner'
import { cn } from '#/lib/utils'

/**
 * App shell: a floating dock in thumb reach (Lific's "chrome floats above
 * content" idea, translated to mobile), safe-area aware. Active tab = blue
 * pill — blue means interactive everywhere; yellow is reserved for selection
 * tags.
 *
 * /chat is full-screen: the composer owns the bottom edge there, so the
 * dock (and its clearance padding) steps aside.
 *
 * Cart (IMA-11) carries a live count badge — the register workflow needs
 * the cart one tap away from anywhere, and the badge answers "did that
 * add actually land" without navigating.
 */
export const Route = createFileRoute('/_app')({ component: AppShell })

// IMA-32: Settings takes the fifth dock slot (was Models). The /models routes
// stay reachable — deep links, the model picker, and Settings' Model row all
// still point at them — they just no longer own a dock tab.
const TABS = [
  { to: '/', label: 'Home', icon: House, exact: true },
  { to: '/chat', label: 'Chat', icon: MessageCircle, exact: false },
  { to: '/scan', label: 'Scan', icon: ScanBarcode, exact: false },
  { to: '/cart', label: 'Cart', icon: ShoppingCart, exact: false },
  { to: '/settings', label: 'Settings', icon: Settings, exact: false },
] as const

function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const immersive = pathname.startsWith('/chat')
  const cartCount = useCart().length

  /* Index of the active tab, -1 on non-tab routes (/search, /product/…):
   * the pill fades out there instead of pinning to a wrong tab. */
  const activeIndex = TABS.findIndex(({ to, exact }) =>
    exact ? pathname === to : pathname.startsWith(to),
  )

  return (
    <div
      className={cn(
        'mx-auto min-h-dvh w-full max-w-lg',
        // viewport-fit=cover pulls the page under the iPhone status bar /
        // Dynamic Island; pad it back out. /chat is h-dvh and owns its own
        // top edge (ChatHeader), so padding there would overflow the column.
        !immersive && 'pt-[env(safe-area-inset-top)]',
      )}
    >
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Install early (pre-first-chat): iOS standalone gets a separate
          IndexedDB, so threads built in the browser tab don't carry over. */}
      {!immersive && <InstallBanner />}

      <main
        id="main"
        className={cn(
          !immersive && 'pb-[calc(6rem+env(safe-area-inset-bottom))]',
        )}
      >
        <Outlet />
      </main>

      {!immersive && (
        <nav
          aria-label="Primary"
          className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 mx-auto max-w-md"
        >
          <div className="chrome-float relative flex rounded-full p-1.5">
            {/* The one pill: glides between tabs, fades out on non-tab routes. */}
            <span
              aria-hidden="true"
              className={cn(
                'dock-pill absolute inset-y-1.5 left-1.5 rounded-full',
                activeIndex < 0 && 'opacity-0',
              )}
              style={{
                width: `calc((100% - 0.75rem) / ${TABS.length})`,
                translate: `${Math.max(activeIndex, 0) * 100}% 0`,
              }}
            />
            {TABS.map(({ to, label, icon: Icon, exact }, i) => {
              const isActive = i === activeIndex
              return (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact }}
                  activeProps={{ className: 'font-bold text-action' }}
                  inactiveProps={{ className: 'font-semibold text-text-muted' }}
                  className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full transition-[color,scale] duration-150 active:scale-90"
                >
                  <span
                    // Remount on activation so the bounce replays every time.
                    key={isActive ? 'on' : 'off'}
                    className={cn('relative', isActive && 'tab-bounce')}
                  >
                    <Icon
                      size={19}
                      strokeWidth={isActive ? 2.4 : 2}
                      aria-hidden="true"
                    />
                    {to === '/cart' && cartCount > 0 && (
                      <span
                        key={cartCount}
                        className="badge-pop tabular absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-action px-1 text-[0.625rem] font-extrabold leading-none text-action-ink"
                      >
                        {cartCount > 9 ? '9+' : cartCount}
                        <span className="sr-only"> items in cart</span>
                      </span>
                    )}
                  </span>
                  <span className="text-micro tracking-wide">{label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      )}
    </div>
  )
}
