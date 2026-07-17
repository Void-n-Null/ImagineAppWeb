/**
 * The audit roster: every model the app currently "has" — the curated
 * recommended picks, the pool-key allowlist, and the default. Imported from
 * source so the roster can't drift from the app.
 */

import { POOL_MODEL_ALLOWLIST } from '#/features/agent/model-allowlist'
import { RECOMMENDED_PICKS } from '#/features/models/recommended'
import { DEFAULT_MODEL_ID } from '#/features/models/selected-model'

export function auditRoster(): string[] {
  const ids = new Set<string>([
    DEFAULT_MODEL_ID,
    ...POOL_MODEL_ALLOWLIST,
    ...RECOMMENDED_PICKS.map((p) => p.id),
  ])
  return [...ids]
}

/**
 * Challenger bench: models NOT in the app that might earn a tier slot.
 * Curated from the live OpenRouter catalog 2026-07-08 — tool-capable, sane
 * pricing, vision strongly preferred (the floor takes photos). Add freely;
 * the audit probe is the cheap gate (ZDR routability + tool call) before a
 * model earns a full 53-question run.
 *
 * Include via `--candidates` on audit-models.ts / run.ts, or ad-hoc with
 * `--add a,b,c` (run.ts) / positional ids (audit-models.ts).
 */
export const CANDIDATE_MODELS: string[] = [
  // Tier-1 (default) challengers — flash-lite money
  'qwen/qwen3.5-flash-02-23', //   $0.07/$0.26  vision
  'openai/gpt-5.4-nano', //        $0.20/$1.25  vision
  'deepseek/deepseek-v4-flash', // $0.09/$0.18  text-only
  // Tier-2 (step-up) challengers
  'openai/gpt-5.4-mini', //        $0.75/$4.50  vision
  'anthropic/claude-haiku-4.5', // $1.00/$5.00  vision
  'moonshotai/kimi-k2.6', //       $0.66/$3.41  vision
  // Tier-3 (best) challengers
  'x-ai/grok-4.20', //             $1.25/$2.50  vision
  'z-ai/glm-5.2', //               $0.93/$3.00  text-only
]

/** Shared model-selection CLI: --models (replace) / --add / --candidates. */
export function resolveModels(argv: string[]): string[] {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const csv = (s: string | undefined): string[] =>
    (s ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)

  const base = value('--models') ? csv(value('--models')) : auditRoster()
  const extra = [
    ...csv(value('--add')),
    ...(argv.includes('--candidates') ? CANDIDATE_MODELS : []),
  ]
  return [...new Set([...base, ...extra])]
}
