import cors from 'cors';

import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

function requestOrigin(request) {
  return `${request.protocol}://${request.get('host')}`;
}

/**
 * Allow same-origin dashboard requests and one explicitly configured extension
 * origin. Other browser origins fail closed.
 *
 * @param {object} input
 * @param {string | undefined} input.extensionAllowedOrigin
 */
export function createCorsPolicy({ extensionAllowedOrigin }) {
  return cors((request, callback) => {
    const origin = request.get('origin');

    if (!origin) {
      callback(null, { origin: false });
      return;
    }

    const isSameOrigin = origin === requestOrigin(request);
    const isAllowedExtension =
      extensionAllowedOrigin !== undefined && origin === extensionAllowedOrigin;

    if (!isSameOrigin && !isAllowedExtension) {
      callback(
        new AppError({
          code: ERROR_CODES.CORS_ORIGIN_DENIED,
          message: 'The request origin is not allowed',
          statusCode: 403,
        }),
      );
      return;
    }

    callback(null, {
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
      credentials: isSameOrigin,
      maxAge: 600,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      origin,
      optionsSuccessStatus: 204,
    });
  });
}
