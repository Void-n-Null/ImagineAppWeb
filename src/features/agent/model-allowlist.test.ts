import { describe, expect, it } from 'vitest'
import { isModelAllowed, poolModelAllowlist } from './model-allowlist'

/**
 * Pool model allowlist (IMA-16 #364). The model is untrusted client input on
 * the shared pool key; only the benchmarked, economically-sane roster
 * (IMA-43) is permitted — Opus-class stays off.
 */

const DEFAULTS = [
  'google/gemini-3.1-flash-lite',
  'google/gemini-3-flash-preview',
  'google/gemini-3.5-flash',
  'anthropic/claude-sonnet-5',
]

describe('poolModelAllowlist', () => {
  it('falls back to the benchmarked defaults when env is unset/empty', () => {
    expect(poolModelAllowlist(undefined)).toEqual(DEFAULTS)
    expect(poolModelAllowlist('')).toEqual(DEFAULTS)
    expect(poolModelAllowlist('  ,  ')).toEqual(DEFAULTS)
  })

  it('parses a comma-separated env override, trimming whitespace', () => {
    expect(poolModelAllowlist('a/b , c/d')).toEqual(['a/b', 'c/d'])
  })
})

describe('isModelAllowed', () => {
  const list = ['google/gemini-3.1-flash-lite', 'anthropic/claude-sonnet-5']

  it('allows models on the list', () => {
    expect(isModelAllowed('google/gemini-3.1-flash-lite', list)).toBe(true)
    expect(isModelAllowed('anthropic/claude-sonnet-5', list)).toBe(true)
  })

  it('rejects frontier / off-list models (no Opus on the pool key)', () => {
    expect(isModelAllowed('anthropic/claude-opus-4.8', list)).toBe(false)
    expect(isModelAllowed('openai/gpt-5', list)).toBe(false)
    expect(isModelAllowed('', list)).toBe(false)
  })
})
