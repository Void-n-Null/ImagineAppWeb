import process from 'node:process'
import { createServerFn } from '@tanstack/react-start'
import { NO_DATA_RETENTION_PROVIDER } from '#/features/agent/openrouter'
import {
  extractContent,
  TRANSCRIPTION_MODEL,
  TRANSCRIPTION_PROMPT,
} from '#/features/chat/voice/transcribe'
import { requireUser, UnauthorizedError } from '#/server/auth'
import { getSpendGate, recordSpend } from '#/server/credits/ledger'
import { getDb } from '#/server/db'
import { checkRateLimit, VOICE_RATE_LIMITS } from '#/server/rate-limit'

/**
 * Voice transcription on the app's pool key (IMA-17 #357, was IMA-25).
 *
 * Phase 1 sent audio straight to OpenRouter from the browser on the user's own
 * key. Phase 2 moves that spend server-side: this server function is the gate
 * — auth → rate-limit (BEFORE any model call) → validate → transcribe. No
 * OpenRouter key ever touches the client for voice anymore.
 *
 * Like every server function here, failures return error VALUES (not throws)
 * so the caller renders a message instead of crashing. The pure wav/base64
 * encoding stays client-side (voice/wav.ts); this only receives the finished
 * base64 WAV.
 */

export type TranscribeVoiceResult =
  | { status: 'ok'; text: string }
  | { status: 'error'; message: string }

interface TranscribeVoiceInput {
  wavBase64: string
}

// ~10 MB of base64 (≈7.5 MB of audio) is the ceiling. A 16 kHz mono 16-bit WAV
// runs ~32 KB/s, so this is comfortably over the 120s recording cap — anything
// bigger is a client bug or abuse, and we reject it before spending a cent.
const MAX_WAV_BASE64_BYTES = 10_000_000

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Exported for unit tests: bounds the untrusted base64 WAV before spend. */
export function validateTranscribeInput(input: unknown): TranscribeVoiceInput {
  const obj = (input ?? {}) as Record<string, unknown>
  if (typeof obj.wavBase64 !== 'string' || obj.wavBase64.length === 0) {
    throw new Error('transcribeVoice expects a base64 WAV string')
  }
  if (byteLength(obj.wavBase64) > MAX_WAV_BASE64_BYTES) {
    throw new Error('Audio recording is too large')
  }
  return { wavBase64: obj.wavBase64 }
}

const OPENROUTER_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions'

/**
 * Build the transcription completion body. Exported pure so a test can assert
 * the request shape — chiefly the data-retention guardrail — without a live
 * OpenRouter call (the handler itself does auth/rate-limit/spend and isn't
 * unit-tested). The recorded audio is Best Buy floor speech (user data) plus,
 * via the prompt, Best Buy product identifiers, so the same no-retention /
 * no-training provider restriction the chat turn uses applies here too
 * (NO_DATA_RETENTION_PROVIDER — Best Buy ToS: providers must not retain or
 * train on Content).
 */
export function buildTranscriptionRequestBody(
  wavBase64: string,
): Record<string, unknown> {
  return {
    model: TRANSCRIPTION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: TRANSCRIPTION_PROMPT },
          {
            type: 'input_audio',
            input_audio: { data: wavBase64, format: 'wav' },
          },
        ],
      },
    ],
    provider: NO_DATA_RETENTION_PROVIDER,
    // Transcription wants latency, not deliberation.
    reasoning: { enabled: false },
    temperature: 0,
    // Usage accounting (IMA-16 Phase 3): the response carries `usage.cost`
    // (actual USD billed) so voice can be metered against the balance.
    usage: { include: true },
  }
}

export const transcribeVoice = createServerFn({ method: 'POST' })
  .inputValidator(validateTranscribeInput)
  .handler(async ({ data }): Promise<TranscribeVoiceResult> => {
    // 1. Auth. Signed-out is an error value, never a spend.
    let userId: number
    try {
      const user = await requireUser()
      userId = user.id
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return { status: 'error', message: 'Sign in to use voice input' }
      }
      throw err
    }

    // 2. Rate limit BEFORE the model call. Voice gets its own bucket, lighter
    //    than turns (20/min + 300/day) since a transcription is one cheap call.
    const rate = await checkRateLimit(userId, VOICE_RATE_LIMITS)
    if (!rate.ok) {
      return {
        status: 'error',
        message: `Too many voice requests — try again in ${rate.retryAfterSeconds}s`,
      }
    }

    // 3. Spend gate (IMA-16 Phase 3): voice spends the pool too. Same ordering
    //    as the turn endpoint — 401 → rate limit → balance gate.
    const db = getDb()
    const gate = await getSpendGate(db, userId)
    if (gate === 'empty_wallet') {
      return {
        status: 'error',
        message: 'Out of credits — top up to use voice input',
      }
    }
    if (gate === 'waitlisted') {
      return {
        status: 'error',
        message:
          "You're on the waitlist — voice unlocks when you're granted credits",
      }
    }

    // 4. Pool key must be configured.
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return { status: 'error', message: 'Voice input is not configured' }
    }

    // 4. The same OpenRouter call the client made in Phase 1: one
    //    non-streaming completion carrying the WAV as an input_audio part on
    //    the fixed transcription model. Bounded by a 30s timeout.
    try {
      const response = await fetch(OPENROUTER_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://imagineapp.net',
          'X-Title': 'Imagine App',
        },
        body: JSON.stringify(buildTranscriptionRequestBody(data.wavBase64)),
        signal: AbortSignal.timeout(30_000),
      })

      if (!response.ok) {
        let message = `Transcription request failed (HTTP ${response.status})`
        try {
          const payload = (await response.json()) as {
            error?: { message?: string }
          }
          if (payload.error?.message) message = payload.error.message
        } catch {
          // Non-JSON error body; keep the status message.
        }
        return { status: 'error', message }
      }

      const payload = (await response.json()) as {
        id?: unknown
        usage?: { cost?: unknown }
      }
      const text = extractContent(payload)

      // Meter the spend (IMA-16 Phase 3). Use the reported cost; the response
      // id (when present) makes it idempotent via the ledger dedupe index.
      // A spend-record failure must NOT fail the transcription — log + return.
      const cost =
        typeof payload.usage?.cost === 'number' ? payload.usage.cost : 0
      if (cost > 0) {
        const generationId =
          typeof payload.id === 'string' && payload.id.length > 0
            ? payload.id
            : undefined
        try {
          await recordSpend(db, userId, cost, { tool: 'voice', generationId })
        } catch (spendErr) {
          console.error('[voice] SPEND RECORD FAILED', {
            userId,
            generationId,
            cost,
            err: spendErr,
          })
        }
      }

      return { status: 'ok', text }
    } catch (err) {
      // Timeout, DNS, parse — the caller gets a value, not a crash.
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'error', message: `Transcription failed: ${message}` }
    }
  })
