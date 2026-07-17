import process from 'node:process'
import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit config (IMA-27). DATABASE_URL comes from the Neon Vercel
 * Marketplace install — `vercel env pull .env.local` locally, injected on
 * Vercel. Migrations are generated into ./drizzle and checked in; apply
 * with `bun run db:migrate`.
 */
export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: fails loudly at CLI time if unset
    url: process.env.DATABASE_URL!,
  },
})
