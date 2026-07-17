/**
 * Deduplicates concurrent calls that share a key: while a call for a key is
 * in flight, later callers await the same promise instead of starting
 * another. Settled calls are evicted, so retries after failure work.
 *
 * Scope is per process. On Vercel that means per warm function instance —
 * cross-instance duplicates are absorbed by the Redis cache instead. This is
 * exactly the gap that produced the live 403 during IMA-19 verification
 * (three identical concurrent lookups → one rate-limited).
 */
export class SingleFlight {
  readonly #inflight = new Map<string, Promise<unknown>>()

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.#inflight.get(key)
    if (existing !== undefined) {
      return existing as Promise<T>
    }
    const promise = fn().finally(() => {
      this.#inflight.delete(key)
    })
    this.#inflight.set(key, promise)
    return promise
  }

  /** Number of keys currently in flight (test/introspection aid). */
  get size(): number {
    return this.#inflight.size
  }
}
