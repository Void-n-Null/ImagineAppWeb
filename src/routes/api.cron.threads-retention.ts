import { createFileRoute } from '@tanstack/react-router'
import { purgeAllExpiredThreads } from '#/server/functions/threads'

type PurgeExpired = () => Promise<number>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function handleThreadsRetentionCron(
  request: Request,
  options: {
    secret?: string
    purge?: PurgeExpired
  } = {},
): Promise<Response> {
  const secret = options.secret ?? process.env.CRON_SECRET
  if (!secret) return json({ error: 'not_configured' }, 500)

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'unauthorized' }, 401)
  }

  const deleted = await (options.purge ?? purgeAllExpiredThreads)()
  return json({ deleted })
}

export const Route = createFileRoute('/api/cron/threads-retention')({
  server: {
    handlers: {
      GET: ({ request }) => handleThreadsRetentionCron(request),
    },
  },
})
