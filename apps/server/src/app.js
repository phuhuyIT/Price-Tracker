import express from 'express';

import { AppError } from './errors/AppError.js';
import { ERROR_CODES } from './errors/errorCodes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createSuccessResponse } from './utils/apiResponse.js';

/**
 * Create the Express application without opening a network port.
 *
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_request, response) => {
    response.json(
      createSuccessResponse({
        service: 'shopee-price-tracker',
        status: 'ok',
      }),
    );
  });

  app.use((request, _response, next) => {
    next(
      new AppError({
        code: ERROR_CODES.ROUTE_NOT_FOUND,
        message: `Route not found: ${request.method} ${request.path}`,
        statusCode: 404,
      }),
    );
  });

  app.use(errorHandler);

  return app;
}
