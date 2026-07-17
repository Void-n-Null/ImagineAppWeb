import process from 'node:process'
import { createFileRoute } from '@tanstack/react-router'
import {
  type AgentEvent,
  buildDefaultToolRegistry,
  runAgent,
  SYSTEM_PROMPT,
  ToolRegistry,
  type TurnEvent,
  type TurnRequestBody,
  validateTurnRequest,
} from '#/features/agent'
import { capTranscript } from '#/features/agent/context-cap'
import {
  isModelAllowed,
  POOL_MODEL_ALLOWLIST,
} from '#/features/agent/model-allowlist'
import { createServerHost } from '#/server/agent/turn-host'
import { requireUser, UnauthorizedError } from '#/server/auth'
import { getSpendGate, recordSpend } from '#/server/credits/ledger'
import { fetchGenerationCost } from '#/server/credits/pool'
import { getDb } from '#/server/db'
import { checkRateLimit, TURN_RATE_LIMITS } from '#/server/rate-limit'

/**
 * POST /api/agent/turn — the server-side agent loop (IMA-17 Phase 2).
 *
 * The loop moves off the browser (user's own OpenRouter key) to here (the
 * app's pool key) because a shared key cannot ship to browsers. The request
 * body is now UNTRUSTED (the caller holds a session cookie, not our key), so:
 * auth → rate-limit BEFORE any spend → hard-validate → stream SSE.
 *
 * Server-fn invocation note: the catalog/web tools call TanStack Start server
 * functions (getProductDetail, webSearch, …). On the server those callables
 * short-circuit — `createServerFn().handler()` returns a fn that runs the
 * handler in-process via the Start request context rather than doing an HTTP
 * round-trip (see node_modules/@tanstack/start-client-core createServerFn.js:
 * the "client" middleware path invokes the bundler-extracted fn, which on the
 * server executes locally). This route handler runs INSIDE a Start request
 * context (clerkMiddleware ran, auth() works), so the tools' server-fn calls
 * resolve without a network hop. No logic extraction was needed.
 */

/* ── Route ──────────────────────────────────────────────────────────────── */

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers })
}

/** Delay before the eventually-consistent generation-cost lookup (IMA-16). */
const GENERATION_COST_DELAY_MS = 1500

/**
 * Record one turn completion's spend (IMA-16 #360). Two paths:
 *
 *  1. Fast path — `usage.cost` is present and > 0: record it directly. The
 *     generationId (when present) makes this idempotent via the ledger unique
 *     index, so a retried usage report is a no-op.
 *  2. Fallback — cost is absent/0 but we have a generationId: OpenRouter's
 *     generation stats are eventually consistent, so wait ~1.5s then
 *     `GET /api/v1/generation` for data.total_cost and record iff positive.
 *
 * All failures are logged (with full context) and swallowed — a spend-record
 * failure must never crash the turn; adminStats.drift surfaces any residue.
 */
async function recordTurnSpend(
  db: ReturnType<typeof getDb>,
  userId: number,
  usage: Record<string, unknown>,
  model: string,
  generationId: string | null,
): Promise<void> {
  const cost = typeof usage.cost === 'number' ? usage.cost : 0

  try {
    if (cost > 0) {
      await recordSpend(db, userId, cost, {
        model,
        generationId: generationId ?? undefined,
      })
      return
    }

    // Fallback: no cost reported but we can look it up by generation id.
    if (generationId) {
      await new Promise((r) => setTimeout(r, GENERATION_COST_DELAY_MS))
      const looked = await fetchGenerationCost(generationId)
      if (looked && looked > 0) {
        await recordSpend(db, userId, looked, { model, generationId })
      }
    }
  } catch (err) {
    console.error('[turn] SPEND RECORD FAILED', {
      userId,
      model,
      generationId,
      cost,
      err,
    })
  }
}

export const Route = createFileRoute('/api/agent/turn')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Auth. Signed-out is a 401, never a spend.
        let userId: number
        try {
          const user = await requireUser()
          userId = user.id
        } catch (err) {
          if (err instanceof UnauthorizedError) {
            return json({ error: 'sign_in_required' }, 401)
          }
          throw err
        }

        // 2. Rate limit BEFORE parsing/validating a large body or calling a
        //    model — and before the balance read. Exceeded → 429 with
        //    Retry-After. (Ordering per IMA-16: 401 → rate limit → spend gate.)
        const rate = await checkRateLimit(userId, TURN_RATE_LIMITS)
        if (!rate.ok) {
          return json(
            {
              error: 'rate_limited',
              retryAfterSeconds: rate.retryAfterSeconds,
            },
            429,
            {
              'Retry-After': String(rate.retryAfterSeconds),
            },
          )
        }

        // 3. Spend gate (IMA-16 Phase 3): a turn starts only with a funded
        //    wallet. Distinguish out-of-credits from not-yet-granted so Phase 4
        //    can render them differently. Both are 402 Payment Required.
        const db = getDb()
        const gate = await getSpendGate(db, userId)
        if (gate === 'empty_wallet') return json({ error: 'empty_wallet' }, 402)
        if (gate === 'waitlisted') return json({ error: 'waitlisted' }, 402)

        // 4. Parse + hard-validate the untrusted body.
        let body: TurnRequestBody
        try {
          const raw: unknown = await request.json()
          body = validateTurnRequest(raw)
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Invalid request body'
          return json({ error: 'invalid_request', message }, 400)
        }

        // 5. Pool key must be configured.
        const apiKey = process.env.OPENROUTER_API_KEY
        if (!apiKey) return json({ error: 'not_configured' }, 500)

        // 6. Model allowlist (IMA-16 #364): the model is untrusted client input
        //    on a shared pool key — reject anything off the cheap-model roster.
        const model = body.model
        if (!isModelAllowed(model)) {
          return json(
            { error: 'model_not_allowed', allowed: POOL_MODEL_ALLOWLIST },
            400,
          )
        }

        // 7. Context cap (IMA-16 #364): transcript growth is the measured cost
        //    driver — trim oldest messages beyond the token budget (protocol-
        //    safe: window starts at a user message, newest user message kept).
        const cappedMessages = capTranscript(body.messages)

        const registry = body.toolsEnabled
          ? buildDefaultToolRegistry()
          : new ToolRegistry()

        // 5. Stream. Every runner/cart/client_action event becomes one SSE
        //    `data:` frame; a keepalive comment every 15s holds the
        //    connection open through long tool chains. The client's abort
        //    (disconnect) is wired into runAgent so the loop stops mid-spend.
        const encoder = new TextEncoder()
        const abort = new AbortController()
        // Client disconnect → abort the loop.
        request.signal.addEventListener('abort', () => abort.abort(), {
          once: true,
        })

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let closed = false
            const write = (chunk: string) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(chunk))
              } catch {
                closed = true
              }
            }
            const emit = (event: TurnEvent) =>
              write(`data: ${JSON.stringify(event)}\n\n`)

            const keepalive = setInterval(
              () => write(': keepalive\n\n'),
              15_000,
            )
            const finish = () => {
              if (closed) return
              closed = true
              clearInterval(keepalive)
              try {
                controller.close()
              } catch {
                // Already closed by an aborted downstream — ignore.
              }
            }

            const host = createServerHost(body.cart, body.clock, emit)

            // Spend recording (IMA-16 #360). Every completion's usage lands in
            // onUsage, which runs in the SSE event path — we must NOT await a
            // DB round-trip there (it would stall the stream). Instead each
            // spend becomes a promise pushed here; we settle them all in the
            // finally, BEFORE closing the stream, so the turn can't be reported
            // done while a debit is still in flight. Failures are logged with
            // full context; adminStats.drift catches any residue.
            const spendPromises: Promise<unknown>[] = []

            try {
              await runAgent({
                apiKey,
                model,
                systemPrompt: SYSTEM_PROMPT,
                transcript: cappedMessages,
                registry,
                host,
                signal: abort.signal,
                // request_scan can't run server-side — hand it to the client.
                clientActionTools: new Set(['request_scan']),
                onEvent: (event: AgentEvent) => emit(event),
                onUsage: (usage, usageModel, generationId) => {
                  spendPromises.push(
                    recordTurnSpend(
                      db,
                      userId,
                      usage,
                      usageModel,
                      generationId,
                    ),
                  )
                },
              })
            } catch (err) {
              // Unexpected failure after the stream started: surface it as a
              // terminal error event pair rather than a dead stream.
              const message =
                err instanceof Error ? err.message : 'Unexpected turn failure'
              emit({ type: 'error', message, authExpired: false })
              emit({ type: 'done', reason: 'error' })
            } finally {
              // Settle all debits before closing — never report done with a
              // spend still pending. allSettled: one failure can't sink others.
              await Promise.allSettled(spendPromises)
              finish()
            }
          },
          cancel() {
            abort.abort()
          },
        })

        return new Response(stream, { headers: SSE_HEADERS })
      },
    },
  },
})
