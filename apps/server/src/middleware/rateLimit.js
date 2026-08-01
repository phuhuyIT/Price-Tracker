import { rateLimit } from 'express-rate-limit';

import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

function rejectionHandler(request, response, next) {
  void request;
  void response;
  next(
    new AppError({
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests; try again later',
      statusCode: 429,
    }),
  );
}

function createLimiter({ identifier, max, windowMs }) {
  return rateLimit({
    handler: rejectionHandler,
    identifier,
    legacyHeaders: false,
    limit: max,
    standardHeaders: 'draft-8',
    windowMs,
  });
}

/**
 * Create the configured product-mutation rate limiter.
 */
export function createMutationRateLimit(rateLimitConfig) {
  return createLimiter({
    identifier: 'product mutations',
    max: rateLimitConfig.max,
    windowMs: rateLimitConfig.windowMs,
  });
}

/**
 * Authentication attempts are deliberately stricter than other mutations.
 */
export function createAuthenticationRateLimit(rateLimitConfig) {
  return createLimiter({
    identifier: 'authentication attempts',
    max: Math.min(rateLimitConfig.max, 10),
    windowMs: rateLimitConfig.windowMs,
  });
}
