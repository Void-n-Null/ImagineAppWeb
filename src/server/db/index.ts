import process from 'node:process'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

// Node 22+ / Bun / edge all ship a global WebSocket; wire it explicitly so
// the driver never falls back to "no WebSocket implementation" at runtime.
if (typeof WebSocket !== 'undefined') {
  neonConfig.webSocketConstructor = WebSocket
}

/**
 * Neon connection (IMA-27). Server-only — never import from client code.
 *
 * Driver choice: the WebSocket `Pool` (drizzle-orm/neon-serverless), NOT
 * neon-http. The http driver can't do interactive transactions, and the
 * credit ledger's whole integrity story (IMA-DOC-16) is `SELECT … FOR
 * UPDATE` + ledger insert + balance update in ONE transaction. The extra
 * WebSocket handshake is noise next to an LLM call, and Vercel fluid
 * compute keeps the pool warm across invocations.
 *
 * Lazy singleton, same construction-from-env idiom as the BB client/cache.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>

let db: Db | undefined

export function getDb(): Db {
  if (db === undefined) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    const pool = new Pool({ connectionString: url })
    db = drizzle(pool, { schema })
  }
  return db
}

export { schema }
