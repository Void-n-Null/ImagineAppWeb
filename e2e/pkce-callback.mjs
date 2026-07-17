// E2E probe for the PKCE callback page. Drives a running dev server with
// system Chrome via playwright-core (no browser download).
//
//   bun run dev            # in one terminal
//   bun e2e/pkce-callback.mjs
//
// Three scenarios: mocked happy path (must land on / with the key stored),
// a real exchange with a bogus code (must show the error UI, not hang), and
// a missing verifier (must show the error UI without calling OpenRouter).
// This script caught the effect-cleanup deadlock that shipped in the first
// callback implementation — keep it passing.
import { chromium } from 'playwright-core'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

async function scenario(name, { mockExchange, delayMs = 150, seedVerifier = true }) {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
  })
  const page = await browser.newPage()
  const logs = []
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

  let exchangeCalls = 0
  await page.route('**/api/v1/auth/keys', async (route) => {
    exchangeCalls++
    if (!mockExchange) return route.continue()
    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ key: 'sk-or-v1-e2e-test-key' }),
    })
  })

  if (seedVerifier) {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'imagine:openrouter-verifier',
        'e2e-verifier-e2e-verifier-e2e-verifier-e2e',
      )
    })
  }

  await page.goto(`${BASE}/callback?code=e2e-test-code`, {
    waitUntil: 'domcontentloaded',
  })

  // Give it ample time to finish whatever it's going to do.
  await page.waitForTimeout(4000)

  const url = page.url()
  const bodyText = (await page.textContent('body'))?.slice(0, 300)
  const storedKey = await page.evaluate(() =>
    localStorage.getItem('imagine:openrouter-key'),
  )
  const verifierLeft = await page.evaluate(() =>
    sessionStorage.getItem('imagine:openrouter-verifier'),
  )

  console.log(`\n=== ${name} ===`)
  console.log('final url:        ', url)
  console.log('exchange calls:   ', exchangeCalls)
  console.log('stored key:       ', storedKey)
  console.log('verifier residue: ', verifierLeft ? 'yes' : 'no')
  console.log('body text:        ', JSON.stringify(bodyText))
  for (const l of logs.slice(0, 15)) console.log('  ', l)

  await browser.close()
}

await scenario('happy path (mocked exchange, 150ms latency)', {
  mockExchange: true,
})
await scenario('real exchange (bogus code → OpenRouter 403)', {
  mockExchange: false,
})
await scenario('missing verifier', { mockExchange: true, seedVerifier: false })
