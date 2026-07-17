import process from 'node:process'

/**
 * Model allowlist for pool-key turns (IMA-16 #364, design: IMA-DOC-16 "Abuse
 * guards"). The turn endpoint runs on Blake's shared pool key, so the model is
 * UNTRUSTED input from the client.
 *
 * Roster re-cut 2026-07-08 from the measured floor benchmark (IMA-43): every
 * default below scored ≥87% with a sane $/question (flash-lite $0.003 →
 * Sonnet 5 $0.027). The spend gate + per-turn metering bound the damage of a
 * pricier pick now, so the list is "benchmarked and economically sane", not
 * "flash-only" — but Opus-class stays off: measured 96% at $0.112/question,
 * i.e. worse than Sonnet at 4x the burn. gemini-3.5-flash is kept only so
 * existing selections don't 400 (dominated by 3-flash-preview: same score,
 * 3.7x the cost — it earns no recommendation).
 *
 * Configurable via POOL_MODEL_ALLOWLIST (comma-separated) so the roster can
 * change without a deploy; falls back to these defaults.
 */

const DEFAULT_ALLOWLIST = [
  'google/gemini-3.1-flash-lite',
  'google/gemini-3-flash-preview',
  'google/gemini-3.5-flash',
  'anthropic/claude-sonnet-5',
] as const

/** The active allowlist: env override (csv) or the defaults. */
export function poolModelAllowlist(
  env: string | undefined = process.env.POOL_MODEL_ALLOWLIST,
): string[] {
  const configured = (env ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
  return configured.length > 0 ? configured : [...DEFAULT_ALLOWLIST]
}

/** Convenience snapshot for callers that just want the current list. */
export const POOL_MODEL_ALLOWLIST = poolModelAllowlist()

/** True iff `model` is on the given allowlist (defaults to the active one). */
export function isModelAllowed(
  model: string,
  allowlist: string[] = POOL_MODEL_ALLOWLIST,
): boolean {
  return allowlist.includes(model)
}
