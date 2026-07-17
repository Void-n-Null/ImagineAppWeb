// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '#/features/agent'
import { THREAD_RETENTION_MS } from '#/lib/retention'
import {
  deleteThread,
  derivePreview,
  deriveTitle,
  generateThreadId,
  listThreads,
  loadTranscript,
  putServerThread,
  saveThread,
} from './thread-store'

function user(content: string, extras?: Partial<ChatMessage>): ChatMessage {
  return {
    id: `u_${Math.random()}`,
    role: 'user',
    content,
    at: Date.now(),
    ...extras,
  } as ChatMessage
}

function assistant(content: string): ChatMessage {
  return {
    id: `a_${Math.random()}`,
    role: 'assistant',
    content,
    at: Date.now(),
  }
}

function toolResult(content: string): ChatMessage {
  return {
    id: `t_${Math.random()}`,
    role: 'tool',
    toolCallId: 'call_1',
    toolName: 'search_products',
    content,
    isError: false,
    at: Date.now(),
  }
}

beforeEach(() => {
  // Fresh database per test; the store opens a connection per call, so
  // swapping the factory fully isolates state.
  globalThis.indexedDB = new IDBFactory()
})

describe('saveThread / loadTranscript', () => {
  it('round-trips a transcript', async () => {
    const id = generateThreadId()
    const messages = [user('Cheapest 65 inch TV?'), assistant('The TCL S4.')]
    await saveThread(id, messages)

    const loaded = await loadTranscript(id)
    expect(loaded).toEqual(messages)
  })

  it('returns null for unknown threads', async () => {
    expect(await loadTranscript('thread_missing')).toBeNull()
  })

  it('ignores empty transcripts — visiting /chat mints no rows', async () => {
    await saveThread(generateThreadId(), [])
    expect(await listThreads()).toEqual([])
  })

  it('preserves createdAt across re-saves and bumps updatedAt', async () => {
    const id = generateThreadId()
    await saveThread(id, [user('hi')])
    const [first] = await listThreads()

    await new Promise((r) => setTimeout(r, 5))
    await saveThread(id, [user('hi'), assistant('hello')])
    const [second] = await listThreads()

    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt)
    expect(second.messageCount).toBe(2)
  })
})

describe('listThreads', () => {
  it('sorts by newest activity first and reads meta only', async () => {
    const a = generateThreadId()
    const b = generateThreadId()
    await saveThread(a, [user('older thread')])
    await new Promise((r) => setTimeout(r, 5))
    await saveThread(b, [user('newer thread')])

    const list = await listThreads()
    expect(list.map((t) => t.id)).toEqual([b, a])
    expect(list[0]).not.toHaveProperty('messages')
  })
})

describe('deleteThread', () => {
  it('removes both meta and transcript', async () => {
    const id = generateThreadId()
    await saveThread(id, [user('doomed')])
    await deleteThread(id)

    expect(await listThreads()).toEqual([])
    expect(await loadTranscript(id)).toBeNull()
  })

  it('is a no-op for unknown ids', async () => {
    await expect(deleteThread('thread_missing')).resolves.toBeUndefined()
  })
})

describe('72-hour retention (BB API ToS)', () => {
  // NB: real timers only. fake-indexeddb drives its transactions on real
  // microtasks/timers, so vi.useFakeTimers() would wedge every IDB op. The
  // store reads real Date.now() for the cutoff, so we stamp updatedAt relative
  // to a captured now with a comfortable margin (a minute) either side of the
  // window — the exact-72h boundary itself is pinned deterministically in
  // src/lib/retention.test.ts (pure, injectable now).
  const MARGIN = 60_000 // 1 minute — dwarfs test execution time, never flaky

  /** Seed a thread whose last update was `ageMs` before now. */
  async function seedAged(ageMs: number): Promise<string> {
    const id = generateThreadId()
    await putServerThread(id, 'aged', [user('hi')], Date.now() - ageMs)
    return id
  }

  it('filters expired threads out of listThreads', async () => {
    const fresh = await seedAged(0)
    await seedAged(THREAD_RETENTION_MS + MARGIN) // comfortably past the window

    const list = await listThreads()
    expect(list.map((t) => t.id)).toEqual([fresh])
  })

  it('evicts expired rows from disk (meta AND transcript), not just hides them', async () => {
    const expired = await seedAged(THREAD_RETENTION_MS + MARGIN)
    // A read triggers the eviction pass...
    await listThreads()
    // ...so the transcript is physically gone, not merely filtered.
    expect(await loadTranscript(expired)).toBeNull()
  })

  it('loadTranscript refuses an expired thread even before eviction runs', async () => {
    const expired = await seedAged(THREAD_RETENTION_MS + MARGIN)
    // loadTranscript is a readonly path that never runs eviction itself; it
    // must still return null for an aged-out thread.
    expect(await loadTranscript(expired)).toBeNull()
  })

  it('retains a thread comfortably inside the window', async () => {
    const kept = await seedAged(THREAD_RETENTION_MS - MARGIN)
    expect((await listThreads()).map((t) => t.id)).toEqual([kept])
    expect(await loadTranscript(kept)).not.toBeNull()
  })
})

describe('deriveTitle', () => {
  it('uses the opening user message', () => {
    expect(
      deriveTitle([user('Compare robot vacuums'), assistant('Sure')]),
    ).toBe('Compare robot vacuums')
  })

  it('truncates long openers with an ellipsis', () => {
    const title = deriveTitle([user('x'.repeat(200))])
    expect(title.length).toBeLessThanOrEqual(64)
    expect(title.endsWith('…')).toBe(true)
  })

  it('falls back to the attached product name for scan-only openers', () => {
    const msg = user('', {
      attachedProducts: [{ sku: 123, name: 'Sony WH-1000XM6', context: 'ctx' }],
    })
    expect(deriveTitle([msg])).toBe('Sony WH-1000XM6')
  })

  it('labels photo-only openers', () => {
    const msg = user('', {
      attachedImages: [
        { dataUrl: 'data:image/jpeg;base64,x', mimeType: 'image/jpeg' },
      ],
    })
    expect(deriveTitle([msg])).toBe('Photo question')
  })

  it('handles empty transcripts', () => {
    expect(deriveTitle([])).toBe('New chat')
  })
})

describe('derivePreview', () => {
  it('uses the newest non-tool message', () => {
    const preview = derivePreview([
      user('question'),
      assistant('answer'),
      toolResult('{"json": true}'),
    ])
    expect(preview).toBe('answer')
  })

  it('strips rich-card tokens from previews', () => {
    const preview = derivePreview([
      assistant('Check out [Product(6535347)] — great value.'),
    ])
    expect(preview).toBe('Check out — great value.')
  })
})
