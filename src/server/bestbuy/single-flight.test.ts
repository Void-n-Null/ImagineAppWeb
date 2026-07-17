import { describe, expect, it } from 'vitest'
import { SingleFlight } from './single-flight'

describe('SingleFlight', () => {
  it('shares one execution among concurrent same-key callers', async () => {
    const sf = new SingleFlight()
    let calls = 0
    const fn = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return 'value'
    }
    const results = await Promise.all([
      sf.run('k', fn),
      sf.run('k', fn),
      sf.run('k', fn),
    ])
    expect(results).toEqual(['value', 'value', 'value'])
    expect(calls).toBe(1)
  })

  it('does not dedupe different keys', async () => {
    const sf = new SingleFlight()
    let calls = 0
    const fn = async () => ++calls
    await Promise.all([sf.run('a', fn), sf.run('b', fn)])
    expect(calls).toBe(2)
  })

  it('runs again after the previous flight settles', async () => {
    const sf = new SingleFlight()
    let calls = 0
    const fn = async () => ++calls
    await sf.run('k', fn)
    await sf.run('k', fn)
    expect(calls).toBe(2)
    expect(sf.size).toBe(0)
  })

  it('propagates rejection to all waiters and evicts the key', async () => {
    const sf = new SingleFlight()
    const fn = () => Promise.reject(new Error('boom'))
    const [a, b] = await Promise.allSettled([sf.run('k', fn), sf.run('k', fn)])
    expect(a.status).toBe('rejected')
    expect(b.status).toBe('rejected')
    expect(sf.size).toBe(0)
    // A later call is not poisoned by the failure.
    await expect(sf.run('k', async () => 'recovered')).resolves.toBe(
      'recovered',
    )
  })
})
