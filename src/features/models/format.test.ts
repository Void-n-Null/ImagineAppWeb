import { describe, expect, it } from 'vitest'
import { formatMonth, formatPerMillion, formatTokens } from './format'

describe('formatPerMillion', () => {
  it('shows whole dollars above $100', () => {
    expect(formatPerMillion(150)).toBe('$150')
  })

  it('shows cents in the $1–$100 range, trimming zeros', () => {
    expect(formatPerMillion(15)).toBe('$15')
    expect(formatPerMillion(2.5)).toBe('$2.5')
    expect(formatPerMillion(3)).toBe('$3')
  })

  it('keeps sub-dollar precision', () => {
    expect(formatPerMillion(0.075)).toBe('$0.075')
    expect(formatPerMillion(0.6)).toBe('$0.6')
  })

  it('handles zero', () => {
    expect(formatPerMillion(0)).toBe('$0')
  })
})

describe('formatTokens', () => {
  it('formats millions', () => {
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })

  it('formats thousands', () => {
    expect(formatTokens(262_144)).toBe('262K')
    expect(formatTokens(8_192)).toBe('8K')
  })

  it('passes small numbers through', () => {
    expect(formatTokens(512)).toBe('512')
  })
})

describe('formatMonth', () => {
  it('formats ISO dates', () => {
    expect(formatMonth('2025-09-29')).toBe('Sep 2025')
  })

  it('returns null for junk', () => {
    expect(formatMonth('not-a-date')).toBeNull()
  })
})
