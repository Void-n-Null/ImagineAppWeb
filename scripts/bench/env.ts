/**
 * Bench key loading. ALWAYS the dev key (dev.openrouter.env) — openrouter.env
 * is the PRODUCTION pool key and must never fund benchmarks. We read the file
 * directly instead of trusting process.env so a sourced .env.local (which may
 * carry the prod key) can't leak in.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function loadDevOpenRouterKey(): string {
  const path = fileURLToPath(new URL('../../dev.openrouter.env', import.meta.url))
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`Missing ${path} — the bench needs the DEV OpenRouter key`)
  }
  const match = text.match(/^OPENROUTER_API_KEY=(.+)$/m)
  const key = match?.[1]?.trim()
  if (!key || !key.startsWith('sk-or-')) {
    throw new Error('dev.openrouter.env does not contain OPENROUTER_API_KEY')
  }
  return key
}
