/**
 * Bun preload plugin: shim `@tanstack/react-start` so the production agent
 * tools (which call createServerFn server functions) run in a plain bun
 * script, outside a Start request context.
 *
 * The real createServerFn wraps handlers in RPC/middleware plumbing that
 * requires the Start AsyncLocalStorage context and a bundler transform (the
 * two-arg extractedFn/serverFn split). None of that exists in `bun run`, so
 * we replace the factory with the minimal contract our server fns use:
 *
 *     createServerFn({ method }).inputValidator(v).handler(fn)
 *       → callable: async ({ data }) => fn({ data: v(data) })
 *
 * Validators still run (the handlers rely on them for clamping/sanitizing).
 *
 * Also shims the auth/ledger/db modules: web_search requires a signed-in
 * user and meters $0.007/live-fetch into the ledger. The bench is not a user
 * — requireUser returns a synthetic user and recordSpend is a no-op, so
 * nothing ever touches Neon. (Exa spend on the bench key is real but tiny
 * and mostly cache-absorbed.)
 *
 * Usage: bun --preload ./scripts/bench/preload.ts scripts/bench/<script>.ts
 */

// Typed access to the Bun global — the repo tsconfig deliberately doesn't
// load bun-types (app code is browser/node), so declare the sliver we use.
interface BunPluginBuilder {
  module(
    specifier: string,
    cb: () => { loader: 'object'; exports: Record<string, unknown> },
  ): void
}
const { plugin } = (
  globalThis as unknown as {
    Bun: {
      plugin(def: { name: string; setup(build: BunPluginBuilder): void }): void
    }
  }
).Bun

type Validator = (input: unknown) => unknown
type Handler = (ctx: { data: unknown }) => Promise<unknown>

function makeBuilder(validator: Validator | null) {
  return {
    inputValidator(v: Validator) {
      return makeBuilder(v)
    },
    handler(fn: Handler) {
      return async (opts?: { data?: unknown }) => {
        const data = validator ? validator(opts?.data) : opts?.data
        return fn({ data })
      }
    },
  }
}

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

const BENCH_USER = {
  id: -1,
  clerkUserId: '__bench__',
  email: 'bench@example.invalid',
}

plugin({
  name: 'tanstack-start-serverfn-shim',
  setup(build) {
    build.module('@tanstack/react-start', () => ({
      loader: 'object',
      exports: {
        createServerFn: () => makeBuilder(null),
      },
    }))
    build.module('#/server/auth', () => ({
      loader: 'object',
      exports: {
        UnauthorizedError,
        ForbiddenError,
        getUser: async () => BENCH_USER,
        requireUser: async () => BENCH_USER,
        requireAdmin: async () => BENCH_USER,
      },
    }))
    build.module('#/server/credits/ledger', () => ({
      loader: 'object',
      exports: {
        recordSpend: async () => undefined,
        getSpendGate: async () => 'ok',
      },
    }))
    build.module('#/server/db', () => ({
      loader: 'object',
      exports: {
        getDb: () => ({}),
      },
    }))
  },
})
