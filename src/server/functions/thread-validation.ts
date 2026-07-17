/**
 * Pure validators for the thread + user-settings server functions (IMA-31).
 *
 * Kept separate from the createServerFn handlers so the bounds logic is
 * unit-testable without a DB or a request. The transcript is the user's OWN
 * data replayed back to them (not model input), so we validate SHAPE loosely —
 * reject non-arrays and entries without a string role to keep garbage out of
 * the DB — but we do NOT re-run the full turn-protocol message validation.
 *
 * Byte-bounding borrows turn-protocol.ts's approach (TextEncoder, no Buffer)
 * so a rogue client can't pad a transcript with megabytes of base64 before we
 * write it.
 */

/** Matches generateThreadId(): `thread_<base36>_<base36>`. Length ≤ 64. */
const THREAD_ID_RE = /^thread_[a-z0-9]+_[a-z0-9]+$/
const THREAD_ID_MAX = 64
const TITLE_MAX = 300
const TRANSCRIPT_MAX_BYTES = 1_500_000 // 1.5 MB serialized (matches turn-protocol)
const SETTINGS_MAX_BYTES = 10_000 // 10 KB patch ceiling

/**
 * JSON value type — what actually crosses the server-fn boundary. TanStack
 * Start's return serializer rejects `unknown` / open `Record<string, unknown>`
 * (it can't prove they're serializable), so transcripts and settings are typed
 * as JsonValue at the wire boundary and cast back on the client.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/** UTF-8 byte length without Buffer — same idiom as turn-protocol.ts. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function isValidThreadId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= THREAD_ID_MAX &&
    THREAD_ID_RE.test(id)
  )
}

/** Truncate (never reject) an over-long title to the column budget. */
export function normalizeTitle(title: unknown): string {
  if (typeof title !== 'string') return ''
  return title.length > TITLE_MAX ? title.slice(0, TITLE_MAX) : title
}

export type TranscriptCheck =
  | { ok: true; transcript: unknown[] }
  | { ok: false; reason: string }

/**
 * Loose transcript validation: must be an array, every entry an object with a
 * string `role`, and the whole thing ≤ 1.5MB serialized. We intentionally do
 * NOT validate content/tool fields — this is the user's replayed history, not
 * untrusted model input.
 */
export function validateTranscript(value: unknown): TranscriptCheck {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'transcript must be an array' }
  }
  for (let i = 0; i < value.length; i++) {
    const entry = value[i]
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>).role !== 'string'
    ) {
      return {
        ok: false,
        reason: `transcript[${i}] must be an object with a string role`,
      }
    }
  }
  // Serialize once and bound bytes — image data URLs make this the real cap.
  const bytes = byteLength(JSON.stringify(value))
  if (bytes > TRANSCRIPT_MAX_BYTES) {
    return {
      ok: false,
      reason: `transcript exceeds ${TRANSCRIPT_MAX_BYTES} bytes`,
    }
  }
  return { ok: true, transcript: value }
}

/* ── User settings allowlist ────────────────────────────────────────────── */

/**
 * Known settings keys and their validators. The allowlist grows DELIBERATELY,
 * not accidentally: an unknown key is a rejection, not a silent write, so a
 * typo'd or attacker-injected key never lands in the jsonb bag.
 */
export const SETTINGS_VALIDATORS: Record<string, (value: unknown) => boolean> =
  {
    selectedModel: (v) => typeof v === 'string' && v.length <= 100,
    showToolActivity: (v) => typeof v === 'boolean',
  }

export const KNOWN_SETTINGS_KEYS = Object.keys(SETTINGS_VALIDATORS)

export type SettingsCheck =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Validate a settings patch: a flat object ≤ 10KB whose every key is on the
 * allowlist and whose value passes that key's validator. Unknown keys are
 * listed back in the error so the caller knows exactly what was rejected.
 */
export function validateSettingsPatch(value: unknown): SettingsCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'settings patch must be an object' }
  }
  const patch = value as Record<string, unknown>
  const bytes = byteLength(JSON.stringify(patch))
  if (bytes > SETTINGS_MAX_BYTES) {
    return {
      ok: false,
      reason: `settings patch exceeds ${SETTINGS_MAX_BYTES} bytes`,
    }
  }

  const unknown: string[] = []
  const invalid: string[] = []
  for (const [key, val] of Object.entries(patch)) {
    const validator = SETTINGS_VALIDATORS[key]
    if (!validator) {
      unknown.push(key)
      continue
    }
    // Nested objects/arrays would make this non-flat; the per-key validators
    // only accept primitives, so a nested value fails here.
    if (!validator(val)) invalid.push(key)
  }
  if (unknown.length > 0) {
    return { ok: false, reason: `unknown settings keys: ${unknown.join(', ')}` }
  }
  if (invalid.length > 0) {
    return {
      ok: false,
      reason: `invalid settings values: ${invalid.join(', ')}`,
    }
  }
  return { ok: true, patch }
}
