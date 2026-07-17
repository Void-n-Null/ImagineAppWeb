import { describe, expect, it } from 'vitest'
import {
  isValidThreadId,
  normalizeTitle,
  validateSettingsPatch,
  validateTranscript,
} from './thread-validation'

describe('isValidThreadId', () => {
  it('accepts the generateThreadId shape', () => {
    // thread_<base36 time>_<base36 rand> — the real generator's output.
    expect(isValidThreadId('thread_lz3k9a_x7f2q1')).toBe(true)
    expect(isValidThreadId('thread_0_a')).toBe(true)
  })

  it('rejects wrong prefixes, charset, and empties', () => {
    expect(isValidThreadId('t_lz3k9a_x7f2q1')).toBe(false)
    expect(isValidThreadId('thread_lz3k9a')).toBe(false) // missing second segment
    expect(isValidThreadId('thread_LZ3K_x7')).toBe(false) // uppercase not base36-lower
    expect(isValidThreadId('thread_lz-3k_x7')).toBe(false) // hyphen
    expect(isValidThreadId('')).toBe(false)
    expect(isValidThreadId(42)).toBe(false)
    expect(isValidThreadId(null)).toBe(false)
  })

  it('rejects ids longer than 64 chars', () => {
    const long = `thread_${'a'.repeat(40)}_${'b'.repeat(40)}`
    expect(long.length).toBeGreaterThan(64)
    expect(isValidThreadId(long)).toBe(false)
  })
})

describe('normalizeTitle', () => {
  it('passes short titles through', () => {
    expect(normalizeTitle('Find a 65 inch TV')).toBe('Find a 65 inch TV')
  })

  it('truncates (never rejects) titles over 300 chars', () => {
    const long = 'x'.repeat(500)
    const out = normalizeTitle(long)
    expect(out).toHaveLength(300)
  })

  it('coerces non-strings to empty', () => {
    expect(normalizeTitle(undefined)).toBe('')
    expect(normalizeTitle(123)).toBe('')
    expect(normalizeTitle(null)).toBe('')
  })
})

describe('validateTranscript', () => {
  it('accepts an array of role-bearing objects', () => {
    const res = validateTranscript([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: '{}', toolName: 'x' },
    ])
    expect(res.ok).toBe(true)
  })

  it('accepts an empty array', () => {
    expect(validateTranscript([]).ok).toBe(true)
  })

  it('rejects non-arrays', () => {
    expect(validateTranscript({}).ok).toBe(false)
    expect(validateTranscript('nope').ok).toBe(false)
    expect(validateTranscript(null).ok).toBe(false)
  })

  it('rejects entries without a string role', () => {
    expect(validateTranscript([{ content: 'no role' }]).ok).toBe(false)
    expect(validateTranscript([{ role: 42, content: 'x' }]).ok).toBe(false)
    expect(validateTranscript(['just a string']).ok).toBe(false)
    expect(validateTranscript([null]).ok).toBe(false)
  })

  it('rejects transcripts over the 1.5MB byte bound', () => {
    // One giant message pushes the serialized JSON past 1.5MB.
    const huge = [{ role: 'user', content: 'a'.repeat(1_600_000) }]
    const res = validateTranscript(huge)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/exceeds/)
  })
})

describe('validateSettingsPatch', () => {
  it('accepts known keys with valid values', () => {
    const res = validateSettingsPatch({
      selectedModel: 'google/gemini-3.5-flash',
      showToolActivity: true,
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.patch.showToolActivity).toBe(true)
  })

  it('accepts a partial patch (single key)', () => {
    expect(validateSettingsPatch({ showToolActivity: false }).ok).toBe(true)
  })

  it('rejects unknown keys and names them', () => {
    const res = validateSettingsPatch({ selectedModel: 'x', hacked: 1 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('hacked')
  })

  it('rejects wrong value types for known keys', () => {
    expect(validateSettingsPatch({ selectedModel: 123 }).ok).toBe(false)
    expect(validateSettingsPatch({ showToolActivity: 'true' }).ok).toBe(false)
  })

  it('rejects an over-long model string', () => {
    expect(validateSettingsPatch({ selectedModel: 'm'.repeat(101) }).ok).toBe(
      false,
    )
  })

  it('rejects non-objects and arrays', () => {
    expect(validateSettingsPatch(null).ok).toBe(false)
    expect(validateSettingsPatch([]).ok).toBe(false)
    expect(validateSettingsPatch('x').ok).toBe(false)
  })

  it('rejects a patch over the 10KB bound', () => {
    // A valid key but an oversized value string blows the byte budget.
    const res = validateSettingsPatch({ selectedModel: 'x'.repeat(20_000) })
    expect(res.ok).toBe(false)
  })
})
