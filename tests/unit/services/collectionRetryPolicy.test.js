import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '../../../packages/shared/errors/errorCodes.js';
import {
  calculateCollectionRetryDelayMs,
  classifyCollectionFailure,
} from '../../../apps/server/src/services/collectionRetryPolicy.js';

describe('collection retry policy', () => {
  it('separates authentication waiting, transient retries, and terminal failures', () => {
    expect(classifyCollectionFailure(ERROR_CODES.AUTHENTICATION_REQUIRED)).toBe('waiting_auth');
    expect(
      [
        ERROR_CODES.COLLECTION_TIMEOUT,
        ERROR_CODES.EXTENSION_UNAVAILABLE,
        ERROR_CODES.FETCH_FAILED,
        ERROR_CODES.NETWORK_TIMEOUT,
        ERROR_CODES.PRICE_SELECTOR_TIMEOUT,
        ERROR_CODES.RATE_LIMITED,
        ERROR_CODES.SHOPEE_SERVER_ERROR,
        ERROR_CODES.TAB_CLOSED_PREMATURELY,
      ].map(classifyCollectionFailure),
    ).toEqual(Array(8).fill('retryable'));
    expect(
      [
        ERROR_CODES.INVALID_PRODUCT_URL,
        ERROR_CODES.INVALID_SHOPEE_PAYLOAD,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        ERROR_CODES.PRODUCT_UNAVAILABLE,
        ERROR_CODES.SCHEMA_PARSE_ERROR,
        ERROR_CODES.SHOP_SUSPENDED,
      ].map(classifyCollectionFailure),
    ).toEqual(Array(6).fill('terminal'));
  });

  it('uses capped exponential backoff with additive jitter', () => {
    expect(
      calculateCollectionRetryDelayMs({
        attempt: 1,
        baseDelayMs: 5_000,
        maxDelayMs: 20_000,
        random: () => 0,
      }),
    ).toBe(5_000);
    expect(
      calculateCollectionRetryDelayMs({
        attempt: 2,
        baseDelayMs: 5_000,
        maxDelayMs: 20_000,
        random: () => 0.5,
      }),
    ).toBe(12_500);
    expect(
      calculateCollectionRetryDelayMs({
        attempt: 4,
        baseDelayMs: 5_000,
        maxDelayMs: 20_000,
        random: () => 1,
      }),
    ).toBe(20_000);
  });
});
