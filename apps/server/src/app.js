import express from 'express';
import helmet from 'helmet';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppError } from './errors/AppError.js';
import { ERROR_CODES } from './errors/errorCodes.js';
import { config } from './config/index.js';
import { logger } from './logging/logger.js';
import { createCorsPolicy } from './middleware/corsPolicy.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { createRequestLogger } from './middleware/requestLogger.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createCollectionJobRoutes } from './routes/collectionJobRoutes.js';
import { createProductRoutes } from './routes/productRoutes.js';
import { createApplicationServices } from './services/applicationServices.js';
import { createSuccessResponse } from './utils/apiResponse.js';

const JSON_BODY_LIMIT = '64kb';
const require = createRequire(import.meta.url);
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const chartBundlePath = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js');

function healthResponse() {
  return createSuccessResponse({
    service: 'shopee-price-tracker',
    status: 'ok',
  });
}

/**
 * Create the Express application without opening a network port.
 *
 * @param {object} [input]
 * @param {object} [input.applicationConfig]
 * @param {object} [input.applicationLogger]
 * @param {() => Date} [input.clock]
 * @param {import('better-sqlite3').Database} [input.database]
 * @param {object} [input.passwordHasher]
 * @param {object} [input.services]
 * @returns {import('express').Express}
 */
export function createApp({
  applicationConfig = config,
  applicationLogger = logger,
  clock,
  database,
  passwordHasher,
  services,
} = {}) {
  if (!services && !database) {
    throw new TypeError('createApp requires a migrated database or composed services');
  }

  const resolvedServices =
    services ??
    createApplicationServices({
      applicationConfig,
      clock,
      database,
      passwordHasher,
    });
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(createRequestLogger({ logger: applicationLogger }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          baseUri: ["'self'"],
          connectSrc: ["'self'"],
          defaultSrc: ["'self'"],
          fontSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:', 'https://*.shopee.vn', 'https://*.susercontent.com'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(createCorsPolicy({ extensionAllowedOrigin: applicationConfig.extensionAllowedOrigin }));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  app.get('/health', (_request, response) => response.json(healthResponse()));
  app.get('/api/health', (_request, response) => response.json(healthResponse()));
  app.get('/api/dashboard-config', (_request, response) =>
    response.json(
      createSuccessResponse({
        authentication: {
          allowRegistration: applicationConfig.auth.allowRegistration,
          enabled: applicationConfig.auth.enabled,
        },
      }),
    ),
  );
  app.use('/api/auth', createAuthRoutes({ applicationConfig, services: resolvedServices }));
  app.use(
    '/api/collection-jobs',
    createCollectionJobRoutes({ applicationConfig, services: resolvedServices }),
  );
  app.use('/api/products', createProductRoutes({ applicationConfig, services: resolvedServices }));
  app.get('/vendor/chart.umd.min.js', (_request, response, next) => {
    response.sendFile(chartBundlePath, (error) => (error ? next(error) : undefined));
  });
  app.use(
    express.static(publicDirectory, {
      etag: true,
      fallthrough: true,
      index: 'index.html',
      maxAge: applicationConfig.environment === 'production' ? '1h' : 0,
    }),
  );

  app.use((request, _response, next) => {
    next(
      new AppError({
        code: ERROR_CODES.ROUTE_NOT_FOUND,
        message: `Route not found: ${request.method} ${request.path}`,
        statusCode: 404,
      }),
    );
  });

  app.use(createErrorHandler({ logger: applicationLogger }));

  return app;
}
