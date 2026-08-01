import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

const FORBIDDEN_KEYS = new Set([
  'accesstoken',
  'authorization',
  'cookie',
  'cookies',
  'headers',
  'raw',
  'rawpayload',
  'rawresponse',
  'requestheaders',
  'responseheaders',
  'token',
]);

function containsForbiddenKey(value) {
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenKey(item));
  }

  if (value === null || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_KEYS.has(key.replaceAll('_', '').toLowerCase()) || containsForbiddenKey(child),
  );
}

/**
 * Reject collector secrets and raw-response wrappers before snapshot handling.
 */
export function rejectUnsafeSnapshot(request, _response, next) {
  if (containsForbiddenKey(request.body)) {
    next(
      new AppError({
        code: ERROR_CODES.INVALID_SHOPEE_PAYLOAD,
        message:
          'Snapshots must not contain raw responses, cookies, headers, or authentication data',
        statusCode: 422,
      }),
    );
    return;
  }

  next();
}
