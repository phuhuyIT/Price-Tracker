import { AppError } from '../errors/AppError.js';
import { ERROR_CODES } from '../errors/errorCodes.js';
import { logger } from '../logging/logger.js';
import { createErrorResponse } from '../utils/apiResponse.js';

function normaliseError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.type === 'entity.too.large') {
    return new AppError({
      cause: error,
      code: ERROR_CODES.REQUEST_TOO_LARGE,
      message: 'The request body is too large',
      statusCode: 413,
    });
  }

  if (error?.type === 'entity.parse.failed') {
    return new AppError({
      cause: error,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'The request body contains invalid JSON',
      statusCode: 400,
    });
  }

  return new AppError({
    cause: error,
    code: ERROR_CODES.INTERNAL_ERROR,
    isOperational: false,
    message: 'An unexpected error occurred',
    statusCode: 500,
  });
}

/** Create central error handling with an injected structured logger. */
export function createErrorHandler({ logger: requestLogger }) {
  return function handleError(error, request, response, _next) {
    void _next;

    const appError = normaliseError(error);
    const logContext = {
      err: appError,
      errorCode: appError.code,
      method: request.method,
      path: request.path,
      requestId: request.requestId,
    };

    if (appError.statusCode >= 500) {
      requestLogger.error(logContext, 'Request failed');
    } else {
      requestLogger.warn(logContext, 'Request rejected');
    }

    response.status(appError.statusCode).json(createErrorResponse(appError));
  };
}

/**
 * Convert thrown errors to the standard JSON error envelope.
 *
 * @param {unknown} error
 * @param {import('express').Request} request
 * @param {import('express').Response} response
 * @param {import('express').NextFunction} _next
 */
export function errorHandler(error, request, response, _next) {
  return createErrorHandler({ logger })(error, request, response, _next);
}
