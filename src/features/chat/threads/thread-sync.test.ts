import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '#/features/agent'
import { createCoalescer, decideMerge } from './thread-sync'

/** A one-message transcript tagged so we can assert which payload landed. */
function transcript(tag: string): ChatMessage[] {
  return [{ id: tag, role: 'user', content: tag, at: 1 }]
}

/** A deferred promise so tests control exactly when a send "settles". */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createCoalescer', () => {
  it('sends the first push immediately', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const c = createCoalescer(send)
    c.push('thread_a_1', { title: 't', transcript: transcript('one') })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('coalesces bursts while in flight into ONE follow-up with the latest', async () => {
    const gates = [deferred(), deferred()]
    let call = 0
    const send = vi.fn().mockImplementation(() => gates[call++]?.promise)
    const c = createCoalescer(send)

    // First push starts in flight (not yet settled).
    c.push('id', { title: 'a', transcript: transcript('a') })
    // Three more while in flight — only the LAST should survive as pending.
    c.push('id', { title: 'b', transcript: transcript('b') })
    c.push('id', { title: 'c', transcript: transcript('c') })
    c.push('id', { title: 'd', transcript: transcript('d') })
    expect(send).toHaveBeenCalledTimes(1)

    // Settle the in-flight one → the single pending (latest, 'd') fires.
    gates[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][1].title).toBe('d')

    // Settle the follow-up → nothing pending, no third call.
    gates[1].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('drains the pending slot even when the in-flight send REJECTS', async () => {
    // Offline-first: a failed upsert must still settle the slot so the pending
    // (latest) payload fires, instead of wedging the thread forever.
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const c = createCoalescer(send)
    c.push('id', { title: 'x', transcript: transcript('x') })
    c.push('id', { title: 'y', transcript: transcript('y') })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][1].title).toBe('y')
  })

  it('keeps separate slots per thread id', () => {
    const send = vi.fn().mockReturnValue(new Promise<void>(() => {}))
    const c = createCoalescer(send)
    c.push('id1', { title: 'a', transcript: transcript('a') })
    c.push('id2', { title: 'b', transcript: transcript('b') })
    // Two distinct ids → two immediate sends, no coalescing between them.
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('decideMerge (LWW)', () => {
  it('pulls when server is newer', () => {
    expect(decideMerge({ updatedAt: 100 }, { updatedAt: 200 })).toBe('pull')
  })

  it('pushes when local is newer', () => {
    expect(decideMerge({ updatedAt: 300 }, { updatedAt: 200 })).toBe('push')
  })

  it('pulls when local is missing (server-only thread)', () => {
    expect(decideMerge({ updatedAt: undefined }, { updatedAt: 200 })).toBe(
      'pull',
    )
  })

  it('pushes when server is missing (local-only thread)', () => {
    expect(decideMerge({ updatedAt: 300 }, { updatedAt: undefined })).toBe(
      'push',
    )
  })

  it('is a noop on equal timestamps', () => {
    expect(decideMerge({ updatedAt: 200 }, { updatedAt: 200 })).toBe('noop')
  })

  it('is a noop when both sides are missing', () => {
    expect(
      decideMerge({ updatedAt: undefined }, { updatedAt: undefined }),
    ).toBe('noop')
  })
})
