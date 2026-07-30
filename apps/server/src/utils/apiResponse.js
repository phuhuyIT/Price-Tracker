import { AppError } from '../errors/AppError.js';
import { ERROR_CODES } from '../errors/errorCodes.js';

/**
 * Create the standard successful API response envelope.
 *
 * @param {unknown} data
 * @param {Record<string, unknown>} [meta]
 * @returns {{success: true, data: unknown, meta?: Record<string, unknown>}}
 */
export function createSuccessResponse(data, meta) {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

/**
 * Create the standard failed API response envelope.
 *
 * @param {unknown} error
 * @returns {{success: false, error: {code: string, message: string, details?: unknown}}}
 */
export function createErrorResponse(error) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError({
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'An unexpected error occurred',
        });

  const errorBody = {
    code: appError.code,
    message: appError.message,
  };

  if (appError.details !== undefined) {
    errorBody.details = appError.details;
  }

  return {
    success: false,
    error: errorBody,
  };
}
