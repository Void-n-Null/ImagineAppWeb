import { describe, expect, it, vi } from 'vitest'
import { handleThreadsRetentionCron } from './api.cron.threads-retention'

const request = (authorization?: string) =>
  new Request('https://imagineapp.net/api/cron/threads-retention', {
    headers: authorization ? { authorization } : undefined,
  })

describe('handleThreadsRetentionCron', () => {
  it('fails closed when CRON_SECRET is not configured', async () => {
    const purge = vi.fn(async () => 0)
    const response = await handleThreadsRetentionCron(request(), {
      secret: '',
      purge,
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'not_configured' })
    expect(purge).not.toHaveBeenCalled()
  })

  it('rejects requests without the matching bearer token', async () => {
    const purge = vi.fn(async () => 0)
    const response = await handleThreadsRetentionCron(request('Bearer wrong'), {
      secret: 'correct',
      purge,
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(purge).not.toHaveBeenCalled()
  })

  it('purges expired rows for an authorized Vercel invocation', async () => {
    const purge = vi.fn(async () => 7)
    const response = await handleThreadsRetentionCron(
      request('Bearer correct'),
      { secret: 'correct', purge },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: 7 })
    expect(purge).toHaveBeenCalledOnce()
  })
})
