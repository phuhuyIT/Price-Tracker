import { AppError } from '../errors/AppError.js';
import { ERROR_CODES } from '../errors/errorCodes.js';
import { logger } from '../logging/logger.js';
import { createErrorResponse } from '../utils/apiResponse.js';

/**
 * Convert thrown errors to the standard JSON error envelope.
 *
 * @param {unknown} error
 * @param {import('express').Request} request
 * @param {import('express').Response} response
 * @param {import('express').NextFunction} _next
 */
export function errorHandler(error, request, response, _next) {
  void _next;

  const appError =
    error instanceof AppError
      ? error
      : new AppError({
          cause: error,
          code: ERROR_CODES.INTERNAL_ERROR,
          isOperational: false,
          message: 'An unexpected error occurred',
          statusCode: 500,
        });

  const logContext = {
    err: appError,
    errorCode: appError.code,
    method: request.method,
    path: request.path,
  };

  if (appError.statusCode >= 500) {
    logger.error(logContext, 'Request failed');
  } else {
    logger.warn(logContext, 'Request rejected');
  }

  response.status(appError.statusCode).json(createErrorResponse(appError));
}
