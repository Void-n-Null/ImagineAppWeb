/**
 * End-to-end probe for the will-it-fit workflow (IMA-50/51). Runs the REAL
 * agent stack (SYSTEM_PROMPT, full registry, production loop) on the DEV key
 * with the exact prompt the /willitfit page sends, then reports every tool
 * call, the final assistant text, and whether a FitVerdict token is
 * recoverable from (a) the final assistant message and (b) the tool results.
 *
 *     set -a; source .env.local; set +a
 *     bun --preload ./scripts/bench/preload.ts scripts/bench/fit-e2e.ts \
 *       [--vehicle "2015 Chevy Equinox"] [--query "65 inch TV"] \
 *       [--model google/gemini-3.1-flash-lite]
 */

import process from 'node:process'
import {
  type AgentEvent,
  buildDefaultToolRegistry,
  type ChatMessage,
  runAgent,
  SYSTEM_PROMPT,
  userMessage,
} from '#/features/agent'
import { parseRichSegments } from '#/features/chat/rich-cards'
import { getBestBuyClient } from '#/server/bestbuy/client'
import { createBenchHost } from './bench-host'
import { loadDevOpenRouterKey } from './env'

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  const value = index === -1 ? undefined : process.argv[index + 1]
  return value ?? fallback
}

const vehicle = argValue('--vehicle', '2015 Chevy Equinox')
const query = argValue('--query', '65 inch TV')
const model = argValue('--model', 'google/gemini-3.1-flash-lite')

const searchFilter = query
  .split(/\s+/)
  .filter((term) => term.length > 0)
  .map((term) => `search=${encodeURIComponent(term.toLowerCase())}`)
  .join('&')
const search = await getBestBuyClient().products(
  `${searchFilter}&categoryPath.id=abcat0101000`,
  { pageSize: '10' },
)
const tv = search.products.find((product) =>
  product.categoryPath.some((category) => category.id === 'abcat0101000'),
)
if (!tv) {
  console.error(`No TV found for query "${query}"`)
  process.exit(1)
}
console.log(`Contender: SKU ${tv.sku} — ${tv.name}`)
console.log(`Vehicle:   ${vehicle}`)
console.log(`Model:     ${model}\n`)

const transcript: ChatMessage[] = [
  userMessage(
    `Run the will-it-fit check: will SKU ${tv.sku} (${tv.name}) fit in a ${vehicle}? Find cargo dimensions and finish with the FitVerdict.`,
  ),
]

let costUsd = 0
const onEvent = (event: AgentEvent) => {
  if (event.type === 'assistant-message' || event.type === 'tool-result') {
    transcript.push(event.message)
  }
  if (event.type === 'tool-start') {
    console.log(
      `→ tool ${event.call.name}(${JSON.stringify(event.call.arguments).slice(0, 160)})`,
    )
  }
  if (event.type === 'tool-result') {
    const preview = event.message.content.replaceAll('\n', ' | ').slice(0, 220)
    console.log(`← ${event.message.isError ? 'ERROR ' : ''}${preview}\n`)
  }
}

const started = performance.now()
try {
  await runAgent({
    apiKey: loadDevOpenRouterKey(),
    model,
    systemPrompt: SYSTEM_PROMPT,
    transcript,
    registry: buildDefaultToolRegistry(),
    host: createBenchHost(),
    signal: new AbortController().signal,
    clientActionTools: new Set(['request_scan']),
    onEvent,
    onUsage: (usage) => {
      if (typeof usage.cost === 'number') costUsd += usage.cost
    },
  })
} catch (err) {
  console.error('runAgent threw:', err instanceof Error ? err.message : err)
}
const seconds = ((performance.now() - started) / 1000).toFixed(1)

const finalAssistant = [...transcript]
  .reverse()
  .find((message) => message.role === 'assistant')
console.log('=== FINAL ASSISTANT MESSAGE ===')
console.log(finalAssistant?.content ?? '(none)')

const fromAssistant = finalAssistant
  ? parseRichSegments(finalAssistant.content).find(
      (segment) => segment.kind === 'fit-verdict',
    )
  : undefined
const fromTools = transcript
  .filter((message) => message.role === 'tool')
  .flatMap((message) => parseRichSegments(message.content))
  .find((segment) => segment.kind === 'fit-verdict')

console.log('\n=== VERDICT RECOVERY ===')
console.log(`assistant message: ${fromAssistant ? 'FOUND' : 'MISSING'}`)
console.log(`tool results:      ${fromTools ? 'FOUND' : 'MISSING'}`)
if (fromTools) console.log('tool verdict:', JSON.stringify(fromTools))
console.log(`\ncost: $${costUsd.toFixed(4)} | wall: ${seconds}s`)
process.exit(0)
