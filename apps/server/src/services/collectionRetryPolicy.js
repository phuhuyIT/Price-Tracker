import { ERROR_CODES } from '@shopee-price-tracker/shared';

const RETRYABLE_ERROR_CODES = new Set([
  ERROR_CODES.COLLECTION_TIMEOUT,
  ERROR_CODES.EXTENSION_UNAVAILABLE,
  ERROR_CODES.FETCH_FAILED,
  ERROR_CODES.NETWORK_TIMEOUT,
  ERROR_CODES.PRICE_SELECTOR_TIMEOUT,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.SHOPEE_SERVER_ERROR,
  ERROR_CODES.TAB_CLOSED_PREMATURELY,
]);

/** Return the persistent job transition for a typed collection failure. */
export function classifyCollectionFailure(errorCode) {
  if (errorCode === ERROR_CODES.AUTHENTICATION_REQUIRED) {
    return 'waiting_auth';
  }

  return RETRYABLE_ERROR_CODES.has(errorCode) ? 'retryable' : 'terminal';
}

/**
 * Calculate capped exponential backoff with additive jitter.
 *
 * Delay = baseDelay * 2^(attempt - 1) + jitter
 */
export function calculateCollectionRetryDelayMs({
  attempt,
  baseDelayMs,
  maxDelayMs,
  random = Math.random,
}) {
  const exponentialDelay = Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), maxDelayMs);
  const jitterLimit = Math.min(baseDelayMs, Math.max(0, maxDelayMs - exponentialDelay));
  const jitter = Math.floor(random() * (jitterLimit + 1));

  return Math.min(exponentialDelay + jitter, maxDelayMs);
}
