/**
 * Imagine App service worker (IMA-12) — APP-SHELL CACHING ONLY.
 *
 * Scope is deliberately tiny:
 *  - Navigations: network-first, falling back to the cached SPA shell so the
 *    installed app opens instantly (and offline shows the shell, not a
 *    dinosaur). Every successful navigation refreshes the cached shell.
 *  - Hashed build assets (/assets/*) and the icon/manifest statics:
 *    cache-first — Vite content-hashes them, so they are immutable.
 *  - EVERYTHING else (server functions, BB proxy, OpenRouter, Exa) passes
 *    straight through to the network. Prices and stock must never be
 *    stale-served; data freshness is Redis's job, not this worker's.
 *
 * Bump VERSION to invalidate the shell cache on breaking shell changes.
 */

const VERSION = 'v1'
const SHELL_CACHE = `ima-shell-${VERSION}`
const ASSET_CACHE = `ima-assets-${VERSION}`
const SHELL_KEY = '/'

const STATIC_ASSETS = [
  '/manifest.json',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE)
      // cache: 'reload' bypasses the HTTP cache so we snapshot the live shell.
      await shell.add(new Request(SHELL_KEY, { cache: 'reload' })).catch(() => {})
      const assets = await caches.open(ASSET_CACHE)
      await Promise.allSettled(STATIC_ASSETS.map((url) => assets.add(url)))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => n.startsWith('ima-') && !n.endsWith(`-${VERSION}`))
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  // Navigations: network-first with cached-shell fallback. In SPA mode every
  // route serves the same shell, so one cache entry covers all paths.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response.ok) {
            const shell = await caches.open(SHELL_CACHE)
            shell.put(SHELL_KEY, response.clone()).catch(() => {})
          }
          return response
        } catch {
          const cached = await caches.match(SHELL_KEY)
          if (cached) return cached
          throw new Error('offline and no cached shell')
        }
      })(),
    )
    return
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  const isImmutableAsset = url.pathname.startsWith('/assets/')
  const isStatic = STATIC_ASSETS.includes(url.pathname)
  if (!isImmutableAsset && !isStatic) return // data → network, untouched

  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(ASSET_CACHE)
        cache.put(request, response.clone()).catch(() => {})
      }
      return response
    })(),
  )
})
