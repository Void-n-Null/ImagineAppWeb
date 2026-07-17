import { ClerkProvider } from '@clerk/tanstack-react-start'
import { PostHogProvider } from '@posthog/react'
import { TanStackDevtools } from '@tanstack/react-devtools'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { useEffect } from 'react'
import {
  posthogApiKey,
  posthogOptions,
  warnIfAnalyticsDisabled,
} from '../features/analytics/analytics'
import { AnalyticsIdentity } from '../features/analytics/identity'
import { registerServiceWorker } from '../features/pwa/register-sw'
import { cleanupRetiredByok } from '../features/settings/byok-cleanup'
import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import appCss from '../styles.css?url'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        // viewport-fit=cover: without it iOS reports zero safe-area insets
        // and the dock/composer collide with the home indicator in
        // standalone mode (IMA-12).
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        title: 'Imagine App',
      },
      {
        name: 'description',
        content:
          'AI-powered floor assistant: scan, search, and compare Best Buy products.',
      },
      { name: 'theme-color', content: '#0d131b' },
      // iOS standalone chrome: dark status bar blending into the app shell.
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'black-translucent',
      },
      { name: 'apple-mobile-web-app-title', content: 'Imagine' },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      { rel: 'manifest', href: '/manifest.json' },
      // iOS has ignored manifest icons across versions — link it explicitly.
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48 32x32 16x16' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    registerServiceWorker()
    // Evict retired BYOK credentials left on the device (IMA-16 #367).
    cleanupRetiredByok()
  }, [])

  useEffect(() => {
    warnIfAnalyticsDisabled()
  }, [])

  const app = (
    <ClerkProvider>
      <AnalyticsIdentity />
      {children}
    </ClerkProvider>
  )

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {posthogApiKey ? (
          <PostHogProvider apiKey={posthogApiKey} options={posthogOptions}>
            {app}
          </PostHogProvider>
        ) : (
          app
        )}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
