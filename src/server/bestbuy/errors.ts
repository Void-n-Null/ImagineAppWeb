/**
 * Typed errors for the Best Buy API client.
 *
 * v1 reference: lib/services/bestbuy/bestbuy_exception.dart. v1 defined
 * `shouldRetry`/`isRateLimitError` and never consumed them — these exist to be
 * consumed (IMA-3 adds the backoff that reads `isRateLimit`).
 */

/** Base class for anything thrown by the Best Buy client. */
export class BestBuyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BestBuyError'
  }
}

/** Non-2xx HTTP response from api.bestbuy.com. */
export class BestBuyHttpError extends BestBuyError {
  readonly status: number
  readonly errorCode: string | null

  constructor(
    status: number,
    message: string,
    errorCode: string | null = null,
  ) {
    super(message)
    this.name = 'BestBuyHttpError'
    this.status = status
    this.errorCode = errorCode
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  /**
   * Best Buy signals the 5-req/sec cap as a 403 with a "per second limit"
   * message (verified live 2026-07-05), and quota exhaustion as 403/429.
   */
  get isRateLimit(): boolean {
    return (
      this.status === 429 ||
      (this.status === 403 && /limit/i.test(this.message))
    )
  }

  /** Transient — a retry with backoff is reasonable. */
  get isRetryable(): boolean {
    return this.isRateLimit || this.status >= 500
  }
}

/** Network failure or timeout before an HTTP response arrived. */
export class BestBuyNetworkError extends BestBuyError {
  readonly isTimeout: boolean

  constructor(
    message: string,
    options?: ErrorOptions & { isTimeout?: boolean },
  ) {
    super(message, options)
    this.name = 'BestBuyNetworkError'
    this.isTimeout = options?.isTimeout ?? false
  }
}

/** 2xx response whose body was not the JSON shape we expected. */
export class BestBuyParseError extends BestBuyError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BestBuyParseError'
  }
}
